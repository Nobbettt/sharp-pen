import * as path from "path";
import * as vscode from "vscode";
import { ProcessRunnerError } from "./ai/processRunner";
import { acceptAll, applyEdits, prepareApply } from "./review/edits";
import { parseReviewIntent, type ReviewIntent } from "./review/intents";
import { reconcileSourceChanges } from "./review/reconcile";
import { markdownTasks, matchesMarkdownTask } from "./review/tasks";
import { markdownFences } from "./review/fences";
import { installedLanguageIds } from "./review/languages";
import type { Decision, Decisions, Level, Review, ResolvedReview, Suggestion } from "./review/types";
import { REVIEW_LIMITS, createReview, frontMatterRange, markdownTooComplex, validateAndResolve } from "./review/validate";
import { reviewWebviewHtml, type ReviewWebviewModel } from "./webview/reviewWebview";
import type { PreviewTheme } from "./config";

export interface AnalysisRequest {
  title: string;
  format: "markdown" | "plaintext";
  source: string;
  uri: string;
  documentVersion: number;
}

/** Phase 2 supplies one provider-neutral function; the controller validates its result. */
export type AnalysisRunner = (request: AnalysisRequest, signal: AbortSignal) => Promise<unknown>;

interface AnalysisJob {
  abort: AbortController;
  previousState: ReviewWebviewModel["state"];
  previousError: ReviewWebviewModel["error"] | undefined;
  previousNotice: string | undefined;
  previousTaskError: boolean;
  previousFenceError: boolean;
  documentChanged: boolean;
}

interface ApplyJob {
  source: string;
  version: number;
  result: string;
  resultVersion: number;
  sawExpectedChange: boolean;
  conflicted: boolean;
}

/** Documents this size or Markdown this structurally complex can't be sent to an agent (see validate.ts). */
function tooLargeOrComplex(source: string, format: "markdown" | "plaintext"): boolean {
  return source.length > REVIEW_LIMITS.source || (format === "markdown" && markdownTooComplex(source));
}

const trustErrorMessage = "Trust this workspace before running sharp-pen analysis.";

export class ReviewController implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private document: vscode.TextDocument;
  private review: Review | undefined;
  private decisions: Decisions = {};
  private state: ReviewWebviewModel["state"] = "empty";
  private error: ReviewWebviewModel["error"] | undefined;
  private analysis: AnalysisJob | undefined;
  private applying: ApplyJob | undefined;
  private sourceEditing = false;
  private taskError = false;
  private fenceError = false;
  private notice: string | undefined;
  private codeFenceLanguages: readonly string[] = [];
  private ignoreEditorScrollUntil = 0;
  private disposed = false;
  private readonly disposables: vscode.Disposable[];

  constructor(
    document: vscode.TextDocument,
    extensionUri: vscode.Uri,
    private readonly runner: AnalysisRunner | undefined,
    private readonly onDispose: () => void,
    column: vscode.ViewColumn,
    private previewTheme: PreviewTheme = "light",
  ) {
    this.document = document;
    this.panel = vscode.window.createWebviewPanel("sharpPen.review", `sharp-pen: ${path.basename(document.fileName)}`, column, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    this.panel.webview.html = reviewWebviewHtml(this.panel.webview, extensionUri);
    this.disposables = [
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
    ];
    void installedLanguageIds().then((languages) => { if (!this.disposed) { this.codeFenceLanguages = languages; this.postState(); } }, () => undefined);
  }

  reveal(column: vscode.ViewColumn): void {
    this.panel.reveal(column, true);
  }

  setPreviewTheme(previewTheme: PreviewTheme): void {
    this.previewTheme = previewTheme;
    this.postState();
  }

  onWorkspaceTrustGranted(): void {
    if (this.error?.message === trustErrorMessage) {
      this.error = undefined;
      if (this.state === "error") this.state = "empty";
    }
    this.postState();
  }

  /**
   * VS Code closes and reopens a document (a new object, same URI) when its language id changes,
   * e.g. switching a .txt buffer to Markdown. Rebind instead of losing the review; a review whose
   * offsets and exclusions were computed for the other format can't carry over, so drop it (see R5-04).
   */
  retarget(document: vscode.TextDocument): void {
    const format = document.languageId === "markdown" ? "markdown" : "plaintext";
    if (this.review && this.review.format !== format) {
      this.review = undefined;
      this.decisions = {};
      if (this.state !== "analyzing") this.state = "empty";
    }
    this.document = document;
    this.postState();
  }

  /** Posts a zoom command to the webview; the review panel owns the zoom level. */
  zoom(command: "in" | "out" | "reset"): void {
    void Promise.resolve(this.panel.webview.postMessage({ type: "zoom", command })).catch(() => undefined);
  }

  /** Accepted options that Apply has not yet written to the document; explicit keeps discard nothing. */
  stagedChoiceCount(): number {
    return Object.values(this.decisions).filter((decision) => decision !== null).length;
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.toString() !== this.document.uri.toString()) return;
    // Save and other dirty-state-only events report no content changes; only real edits reconcile the review.
    if (event.contentChanges.length === 0) return;
    if (this.analysis) this.analysis.documentChanged = true;
    const source = event.document.getText();
    if (this.applying) {
      if (event.document.version === this.applying.resultVersion && source === this.applying.result) {
        this.applying.sawExpectedChange = true;
      } else {
        this.applying.conflicted = true;
      }
    }
    if (this.review) {
      const result = reconcileSourceChanges(this.review, this.decisions, event.contentChanges, source, event.document.version);
      this.review = result.review;
      this.decisions = result.decisions;
      if (this.state !== "analyzing") this.state = "modified";
    }
    this.postState();
  }

  onEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (this.disposed) return;
    if (event.textEditor.document.uri.toString() !== this.document.uri.toString()) return;
    if (Date.now() < this.ignoreEditorScrollUntil) return;
    const visible = event.visibleRanges[0];
    if (!visible) return;
    const visibleLines = visible.end.line - visible.start.line + 1;
    const maximumTopLine = Math.max(0, this.document.lineCount - visibleLines);
    const ratio = maximumTopLine ? Math.min(1, visible.start.line / maximumTopLine) : 0;
    void Promise.resolve(this.panel.webview.postMessage({ type: "sourceScroll", ratio })).catch(() => undefined);
  }

  async analyze(): Promise<void> {
    if (this.sourceEditing) return this.postState();
    if (this.applying || this.analysis) return;
    if (!vscode.workspace.isTrusted) return this.fail(trustErrorMessage);
    if (!this.runner) return this.fail("Analysis is not connected yet.", "openSettings");
    const snapshot = this.snapshot();
    if (tooLargeOrComplex(snapshot.source, snapshot.format)) return this.fail("Document is too large or complex to analyze.");
    const job: AnalysisJob = { abort: new AbortController(), previousState: this.state, previousError: this.error, previousNotice: this.notice, previousTaskError: this.taskError, previousFenceError: this.fenceError, documentChanged: false };
    this.analysis = job;
    this.state = "analyzing";
    this.taskError = false;
    this.fenceError = false;
    this.error = undefined;
    this.notice = undefined;
    this.postState();
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "sharp-pen is analyzing", cancellable: true },
        async (_progress, token) => {
          token.onCancellationRequested(() => {
            if (this.analysis === job) this.cancelAnalysis();
            else job.abort.abort();
          });
          const result = await this.runner!(snapshot, job.abort.signal);
          if (job.abort.signal.aborted || this.analysis !== job) return;
          if (this.document.version !== snapshot.documentVersion) {
            this.state = this.review ? (job.documentChanged || job.previousState === "modified" ? "modified" : "ready") : "error";
            this.error = { message: "Document changed during analysis. Re-analyze to refresh suggestions.", action: "analyze" };
            return;
          }
          const resolved = validateAndResolve(snapshot.source, result, snapshot.format, snapshot.title);
          this.publish(snapshot, resolved, this.stagedChoiceCount());
        },
      );
    } catch (error) {
      if (!job.abort.signal.aborted && this.analysis === job) {
        this.state = this.review ? (job.documentChanged || job.previousState === "modified" ? "modified" : "ready") : "error";
        this.error = error instanceof ProcessRunnerError
          ? { message: error.message, action: error.kind === "launch" ? "openSettings" : "analyze" }
          : { message: "Analysis failed. Try switching models or retrying.", action: "analyze" };
      }
    } finally {
      if (this.analysis === job) this.analysis = undefined;
      this.postState();
    }
  }

  cancelAnalysis(): void {
    const job = this.analysis;
    if (!job) return;
    this.analysis = undefined;
    job.abort.abort();
    this.state = this.review && job.documentChanged ? "modified" : job.previousState;
    this.error = job.previousError;
    this.notice = job.previousNotice;
    this.taskError = job.previousTaskError;
    this.fenceError = job.previousFenceError;
    this.postState();
  }

  async apply(): Promise<void> {
    if (this.sourceEditing) return this.postState();
    if (this.applying || this.analysis || !this.review) return;
    this.taskError = false;
    this.fenceError = false;
    const document = this.document;
    const source = document.getText();
    const version = document.version;
    const prepared = prepareApply(this.review, this.decisions, source, version);
    this.review = prepared.review;
    this.decisions = prepared.decisions;
    if (!prepared.canApply) {
      this.state = "modified";
      this.error = { message: "Document changed; re-analyze before applying.", action: "analyze" };
      return this.postState();
    }
    if (!prepared.edits.length) return this.postState();
    // VS Code normalizes inserted text to the document's own EOL; matching that here keeps the
    // expected-result comparison in onDocumentChanged accurate for CRLF documents and CRLF options alike.
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const edits = prepared.edits.map((item) => ({ ...item, text: item.text.replace(/\r\n|\r|\n/g, eol) }));
    const job: ApplyJob = {
      source,
      version,
      result: applyEdits(source, edits),
      resultVersion: version + 1,
      sawExpectedChange: false,
      conflicted: false,
    };
    this.applying = job;
    this.postState();
    try {
      const edit = new vscode.WorkspaceEdit();
      for (const item of edits) {
        edit.replace(document.uri, new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)), item.text);
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied || job.conflicted || !job.sawExpectedChange || document.version !== job.resultVersion || document.getText() !== job.result) {
        const conflicted = job.conflicted || document.version !== job.version || document.getText() !== job.source;
        if (conflicted) {
          this.state = "modified";
          this.error = {
            message: "Document changed while sharp-pen applied staged changes. Review remains open; verify it and re-analyze before applying again.",
            action: "analyze",
          };
        } else {
          this.error = { message: "sharp-pen could not apply the staged changes. Try Apply again.", action: "apply" };
        }
        return;
      }
      this.review = undefined;
      this.decisions = {};
      this.state = "applied";
      this.error = undefined;
      this.notice = undefined;
    } catch {
      const conflicted = job.conflicted || document.version !== job.version || document.getText() !== job.source;
      if (conflicted) {
        this.state = "modified";
        this.error = {
          message: "Document changed while sharp-pen applied staged changes. Review remains open; verify it and re-analyze before applying again.",
          action: "analyze",
        };
      } else {
        this.error = { message: "sharp-pen could not apply the staged changes. Try Apply again.", action: "apply" };
      }
    } finally {
      if (this.applying === job) this.applying = undefined;
      this.postState();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.cancelAnalysis();
      for (const disposable of this.disposables.splice(0)) disposable.dispose();
      this.panel.dispose();
    } finally {
      this.onDispose();
    }
  }

  private receive(message: unknown): void {
    const intent = parseReviewIntent(message);
    if (!intent) return;
    switch (intent.type) {
      case "ready": this.postState(); return this.postEditorScroll();
      case "analyze": void this.analyze(); return;
      case "cancel": return this.cancelAnalysis();
      case "choose": return this.choose(intent);
      case "acceptAll": return this.acceptAll(intent.level);
      case "reset": return this.reset(intent.level);
      case "apply": void this.apply(); return;
      case "scrollSource": return this.scrollSource(intent.ratio);
      case "toggleTask": void this.toggleTask(intent); return;
      case "setCodeFenceLanguage": void this.setCodeFenceLanguage(intent); return;
      case "openSettings": void vscode.commands.executeCommand("sharpPen.openSettings"); return;
    }
  }

  private postEditorScroll(): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === this.document.uri.toString());
    if (editor) this.onEditorVisibleRanges({ textEditor: editor, visibleRanges: editor.visibleRanges } as vscode.TextEditorVisibleRangesChangeEvent);
  }

  private scrollSource(ratio: number): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === this.document.uri.toString());
    const visible = editor?.visibleRanges[0];
    if (!editor || !visible) return;
    const visibleLines = visible.end.line - visible.start.line + 1;
    const line = Math.round(ratio * Math.max(0, this.document.lineCount - visibleLines));
    if (line === visible.start.line) return;
    this.ignoreEditorScrollUntil = Date.now() + 200;
    editor.revealRange(this.document.lineAt(line).range, vscode.TextEditorRevealType.AtTop);
  }

  private async setCodeFenceLanguage(intent: Extract<ReviewIntent, { type: "setCodeFenceLanguage" }>): Promise<void> {
    if (this.sourceEditing || this.applying || this.analysis || !vscode.workspace.isTrusted || this.document.languageId !== "markdown") return this.postState();
    if (intent.languageId && !this.codeFenceLanguages.includes(intent.languageId)) return this.postState();
    const document = this.document;
    const source = document.getText();
    const fence = document.version === intent.documentVersion ? markdownFences(source).find((item) => item.index === intent.fenceIndex) : undefined;
    if (!fence) return this.postState();
    const language = intent.languageId || (fence.language && fence.hasMetadata ? "plaintext" : "");
    if (language === fence.language) return this.postState();
    this.sourceEditing = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(fence.languageStart), document.positionAt(fence.languageEnd)), language);
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error("not applied");
      if (this.fenceError) {
        this.fenceError = false;
        this.error = undefined;
        this.postState();
      }
    } catch {
      this.fenceError = true;
      this.taskError = false;
      this.error = { message: "Could not update this code language. Try again." };
      this.postState();
    } finally {
      this.sourceEditing = false;
      this.postState();
    }
  }

  private async toggleTask(intent: Extract<ReviewIntent, { type: "toggleTask" }>): Promise<void> {
    if (this.sourceEditing || this.applying || this.analysis || !vscode.workspace.isTrusted || this.document.languageId !== "markdown") return this.postState();
    const document = this.document;
    const source = document.getText();
    if (document.version !== intent.documentVersion || !matchesMarkdownTask(source, intent.offset, !intent.checked)) return this.postState();
    this.sourceEditing = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(intent.offset), document.positionAt(intent.offset + 3)), intent.checked ? "[x]" : "[ ]");
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        this.taskError = true;
        this.fenceError = false;
        this.error = { message: "Could not update this task. Try again." };
        this.postState();
      }
      else if (this.taskError) {
        this.taskError = false;
        this.error = undefined;
        this.postState();
      }
    } catch {
      this.taskError = true;
      this.fenceError = false;
      this.error = { message: "Could not update this task. Try again." };
      this.postState();
    } finally {
      this.sourceEditing = false;
      this.postState();
    }
  }

  private choose(intent: Extract<ReviewIntent, { type: "choose" }>): void {
    if (this.applying || this.analysis) return;
    const suggestion = this.suggestion(intent.suggestionId);
    if (!suggestion || suggestion.status !== "active" || (intent.option !== null && intent.option >= suggestion.options.length)) return;
    this.decisions = { ...this.decisions, [suggestion.id]: intent.option === null ? null : { option: intent.option } };
    this.postState();
  }

  private acceptAll(level: Level): void {
    if (this.applying || this.analysis || !this.review) return;
    this.decisions = acceptAll(this.review, this.decisions, level);
    this.postState();
  }

  private reset(level: Level): void {
    if (this.applying || this.analysis || !this.review) return;
    const next: Record<string, Decision> = { ...this.decisions };
    for (const suggestion of this.review[`level${level}`]) delete next[suggestion.id];
    this.decisions = next;
    this.postState();
  }

  private suggestion(id: string): Suggestion | undefined {
    return this.review && [...this.review.level1, ...this.review.level2].find((suggestion) => suggestion.id === id);
  }

  private snapshot(): AnalysisRequest {
    return {
      title: path.basename(this.document.fileName), format: this.document.languageId === "markdown" ? "markdown" : "plaintext",
      source: this.document.getText(), uri: this.document.uri.toString(), documentVersion: this.document.version,
    };
  }

  private publish(snapshot: AnalysisRequest, resolved: ResolvedReview, discardedChoices: number): void {
    this.review = createReview(snapshot.source, { documentVersion: snapshot.documentVersion, format: snapshot.format }, resolved);
    this.decisions = {};
    this.state = "ready";
    this.error = undefined;
    // Re-analysis silently wipes every staged choice (see R5-06); a warning here is the only notice of that loss.
    const notices: string[] = [];
    if (discardedChoices > 0) notices.push(`${discardedChoices} staged choice${discardedChoices === 1 ? "" : "s"} ${discardedChoices === 1 ? "was" : "were"} discarded by re-analysis.`);
    if (resolved.skipped > 0) notices.push(`${resolved.skipped} suggestion${resolved.skipped === 1 ? "" : "s"} could not be placed and ${resolved.skipped === 1 ? "was" : "were"} skipped.`);
    this.notice = notices.length ? notices.join(" ") : undefined;
  }

  private fail(message: string, action?: "openSettings" | "analyze" | "apply"): void {
    this.taskError = false;
    this.fenceError = false;
    this.state = this.review ? (this.state === "modified" ? "modified" : "ready") : "error";
    this.error = { message, ...(action ? { action } : {}) };
    this.postState();
  }

  private postState(): void {
    if (this.disposed) return;
    const source = this.review?.currentSource ?? this.document.getText();
    const format = this.document.languageId === "markdown" ? "markdown" : "plaintext";
    const oversized = tooLargeOrComplex(source, format);
    const suggestion = (item: Suggestion) => ({
      ...item,
      decision: this.decisions[item.id]?.option ?? null,
      decided: Object.hasOwn(this.decisions, item.id),
    });
    const model: ReviewWebviewModel = {
      title: path.basename(this.document.fileName), format,
      currentSource: oversized ? "" : source,
      documentVersion: this.document.version,
      level1: oversized ? [] : this.review?.level1.map(suggestion) ?? [],
      level2: oversized ? [] : this.review?.level2.map(suggestion) ?? [],
      state: this.state, applying: this.applying !== undefined,
      canAnalyze: !oversized && vscode.workspace.isTrusted && this.runner !== undefined && !this.sourceEditing && !this.applying && !this.analysis,
      hasReview: this.review !== undefined,
      canToggleTasks: !oversized && vscode.workspace.isTrusted && this.document.languageId === "markdown" && !this.sourceEditing && !this.applying && !this.analysis,
      tasks: oversized || this.document.languageId !== "markdown" ? [] : markdownTasks(source),
      fences: oversized || this.document.languageId !== "markdown" ? [] : markdownFences(source),
      // The webview drops this slice from every rendered pane; markdown-it has no front-matter rule, so
      // rendering it raw turns "---" into a thematic break and the YAML into a bogus heading (see R5-05).
      frontMatterEnd: oversized || this.document.languageId !== "markdown" ? 0 : (frontMatterRange(source)?.end ?? 0),
      codeFenceLanguages: this.codeFenceLanguages,
      previewTheme: this.previewTheme,
      ...(this.error ? { error: this.error } : oversized ? { error: { message: "Document is too large or complex to analyze." } } : {}),
      ...(this.notice ? { notice: this.notice } : {}),
    };
    void Promise.resolve(this.panel.webview.postMessage({ type: "state", model })).catch(() => undefined);
  }
}
