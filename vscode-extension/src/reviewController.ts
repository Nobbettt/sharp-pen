import * as path from "path";
import * as vscode from "vscode";
import { ProcessRunnerError } from "./ai/processRunner";
import { acceptAll, applyEdits, prepareApply } from "./review/edits";
import { parseReviewIntent, type ReviewIntent } from "./review/intents";
import { reconcileSourceChanges } from "./review/reconcile";
import { markdownTasks, matchesMarkdownTask } from "./review/tasks";
import { markdownFences } from "./review/fences";
import { parseMarkdownTree } from "./review/markdownTree";
import { installedLanguageIds } from "./review/languages";
import type { Chunk } from "./review/chunks";
import type { Decision, Decisions, Level, Review, ResolvedReview, Suggestion } from "./review/types";
import { CHUNK_CONCURRENCY, chunkDocumentAsync, quickAnalysisProblem, sectionTooLargeMessage } from "./review/chunks";
import { REVIEW_LIMITS, ReviewValidationError, createReview, frontMatterRange, markdownComplexityMessage, validateAndResolve } from "./review/validate";
import { reviewWebviewHtml, type ReviewWebviewModel } from "./webview/reviewWebview";
import type { PreviewTheme } from "./config";

export interface AnalysisRequest {
  title: string;
  format: "markdown" | "plaintext";
  source: string;
  uri: string;
  documentVersion: number;
  /** Set only when the document is analysed in sections; `source` is then just that section's text. */
  chunk?: { index: number; total: number; section?: string };
}

/** Phase 2 supplies one provider-neutral function; the controller validates its result. */
export type AnalysisRunner = (request: AnalysisRequest, signal: AbortSignal) => Promise<unknown>;

interface AnalysisJob {
  abort: AbortController;
  format: "markdown" | "plaintext";
  previousState: ReviewWebviewModel["state"];
  previousError: ReviewWebviewModel["error"] | undefined;
  previousNotice: string | undefined;
  previousTaskError: boolean;
  previousFenceError: boolean;
  /** The review shown before the run; sections replace the displayed review as they finish, so Cancel and an edit restore this one. */
  previousReview: Review | undefined;
  previousDecisions: Decisions;
  documentChanged: boolean;
  /** An edit aborted the run (as opposed to Cancel): the run ends with the "document changed" error. */
  editAborted: boolean;
  progress?: { done: number; total: number };
}

interface ApplyJob {
  source: string;
  version: number;
  result: string;
  resultVersion: number;
  sawExpectedChange: boolean;
  conflicted: boolean;
}

const tooLargeMessage = "Document is too large or complex to analyze.";
let blockerCache: { source: string; format: string; message: string | undefined } | undefined;

/**
 * Why a document can't be analysed, or undefined when it can. It runs on every typing state post, so the
 * answer for the same text is remembered and the check stays linear (see quickAnalysisProblem). A Markdown
 * section too big for one request needs a parse to find, so that error surfaces when the analysis starts.
 */
function analysisBlocker(source: string, format: "markdown" | "plaintext"): string | undefined {
  if (blockerCache && blockerCache.source === source && blockerCache.format === format) return blockerCache.message;
  let message: string | undefined;
  if (source.length > REVIEW_LIMITS.document) message = tooLargeMessage;
  else {
    const problem = quickAnalysisProblem(source, format);
    if (problem) message = problem === "section" ? sectionTooLargeMessage : tooLargeMessage;
  }
  blockerCache = { source, format, message };
  return message;
}

/** The document can't be split into sections (one is too big for a request, or too complex to read). */
class SectionError extends Error {}

/** The text a section's failure is described with; raw CLI output never reaches it (see ProcessRunnerError). */
const failureText = (error: unknown) => error instanceof ProcessRunnerError || (error instanceof ReviewValidationError && error.message === markdownComplexityMessage) ? error.message : "Analysis failed.";

const trustErrorMessage = "Trust this workspace before running sharp-pen analysis.";
/** While typing, at most one state per this interval reaches the webview (each parses and re-renders the document). */
const TYPING_STATE_INTERVAL_MS = 50;

export class ReviewController implements vscode.Disposable {
  private host: vscode.WebviewPanel | undefined;
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
  private panelDisposables: vscode.Disposable[] = [];
  private typingTimer: ReturnType<typeof setTimeout> | undefined;
  private typingStatePending = false;

  constructor(
    document: vscode.TextDocument,
    extensionUri: vscode.Uri,
    private readonly runner: AnalysisRunner | undefined,
    private readonly onDispose: () => void,
    column: vscode.ViewColumn,
    private previewTheme: PreviewTheme = "light",
    /** An open review panel to take over (see attach) instead of creating one. */
    panel?: vscode.WebviewPanel,
  ) {
    this.document = document;
    if (panel) this.attach(panel);
    else {
      const created = vscode.window.createWebviewPanel("sharpPen.review", `sharp-pen: ${path.basename(document.fileName)}`, column, {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        // There is only ever one review panel, so keeping it alive while hidden costs one webview; otherwise
        // every tab switch reloads it and re-renders every Mermaid diagram.
        retainContextWhenHidden: true,
      });
      created.webview.html = reviewWebviewHtml(created.webview, extensionUri);
      this.bind(created);
    }
    void installedLanguageIds().then((languages) => { if (!this.disposed) { this.codeFenceLanguages = languages; this.postState(); } }, () => undefined);
  }

  /** The review panel while this document is the one it shows; undefined while another document has it. */
  get panel(): vscode.WebviewPanel | undefined {
    return this.host;
  }

  /**
   * Shows this document's review in an already-open panel. There is one review panel: it follows the
   * active document, and each document keeps its own review, staged choices, and analysis while hidden.
   */
  attach(panel: vscode.WebviewPanel): void {
    this.bind(panel);
    panel.title = `sharp-pen: ${path.basename(this.document.fileName)}`;
    this.postState();
    this.postEditorScroll();
  }

  /** Stops showing this review, handing back its panel open and untouched. */
  detach(): vscode.WebviewPanel | undefined {
    for (const disposable of this.panelDisposables.splice(0)) disposable.dispose();
    const panel = this.host;
    this.host = undefined;
    return panel;
  }

  reveal(column: vscode.ViewColumn): void {
    this.host?.reveal(column, true);
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
    if ((this.review && this.review.format !== format) || (this.analysis && this.analysis.format !== format)) {
      // A run's Cancel restores the review shown before it, which belongs to the other format: its offsets were
      // checked against the other format's exclusions, so Apply could write into Markdown syntax. Stop the run first.
      this.cancelAnalysis();
      this.review = undefined;
      this.decisions = {};
      this.state = "empty";
    }
    this.document = document;
    this.postState();
  }

  /** Posts a zoom command to the webview; the review panel owns the zoom level. */
  zoom(command: "in" | "out" | "reset"): void {
    this.post({ type: "zoom", command });
  }

  /** Accepted options that Apply has not yet written to the document; explicit keeps discard nothing. */
  stagedChoiceCount(): number {
    return Object.values(this.decisions).filter((decision) => decision !== null).length;
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.toString() !== this.document.uri.toString()) return;
    // Save and other dirty-state-only events report no content changes; only real edits reconcile the review.
    if (event.contentChanges.length === 0) return;
    const source = event.document.getText();
    const job = this.analysis;
    if (job) {
      job.documentChanged = true;
      // The suggestions in flight were placed against text that no longer exists: stop paying for them now.
      if (!job.abort.signal.aborted) { job.editAborted = true; job.abort.abort(); }
      if (job.previousReview) {
        const previous = reconcileSourceChanges(job.previousReview, job.previousDecisions, event.contentChanges, source, event.document.version);
        job.previousReview = previous.review;
        job.previousDecisions = previous.decisions;
      }
    }
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
    this.postTypingState();
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
    this.post({ type: "sourceScroll", ratio });
  }

  async analyze(): Promise<void> {
    if (this.sourceEditing) return this.postState();
    if (this.applying || this.analysis) return;
    if (!vscode.workspace.isTrusted) return this.fail(trustErrorMessage);
    if (!this.runner) return this.fail("Analysis is not connected yet.", "openSettings");
    const snapshot = this.snapshot();
    const blocker = analysisBlocker(snapshot.source, snapshot.format);
    if (blocker) return this.fail(blocker);
    const job: AnalysisJob = {
      abort: new AbortController(), format: snapshot.format, previousState: this.state, previousError: this.error, previousNotice: this.notice, previousTaskError: this.taskError,
      previousFenceError: this.fenceError, previousReview: this.review, previousDecisions: this.decisions, documentChanged: false, editAborted: false,
    };
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
        async (progress, token) => {
          token.onCancellationRequested(() => {
            if (this.analysis === job) this.cancelAnalysis();
            else job.abort.abort();
          });
          const stopped = () => job.abort.signal.aborted || this.analysis !== job;
          // Reading a million characters takes seconds; an edit or Cancel during it stops the run here.
          let chunks: Chunk[] | undefined;
          try {
            chunks = await chunkDocumentAsync(snapshot.source, snapshot.format, stopped);
          } catch (error) {
            throw new SectionError(error instanceof ReviewValidationError ? error.message : tooLargeMessage);
          }
          const total = chunks?.length ?? 0;
          if (total > 1) {
            job.progress = { done: 0, total };
            this.postState();
          }
          const outcomes: Array<ResolvedReview | undefined> = new Array(total).fill(undefined);
          const failures: Array<{ index: number; error: unknown }> = [];
          let next = 0;
          let done = 0;
          // Each worker takes the next unstarted section, so at most CHUNK_CONCURRENCY requests are ever in flight.
          const worker = async (): Promise<void> => {
            while (!stopped() && next < total) {
              const index = next++;
              const chunk = chunks![index];
              const text = snapshot.source.slice(chunk.start, chunk.end);
              try {
                const request: AnalysisRequest = total > 1
                  ? { ...snapshot, source: text, chunk: { index, total, ...(chunk.section ? { section: chunk.section } : {}) } }
                  : snapshot;
                const result = await this.runner!(request, job.abort.signal);
                if (stopped()) return;
                outcomes[index] = placeInDocument(validateAndResolve(text, result, snapshot.format, snapshot.title, chunk.start === 0), chunk.start, total > 1 ? `c${index}-` : "");
              } catch (error) {
                if (stopped()) return;
                failures.push({ index, error });
              }
              done += 1;
              if (total > 1) {
                job.progress = { done, total };
                progress.report({ message: `${done} of ${total} sections` });
                // Show what is finished so far; the run's own state stays "analyzing" and read-only.
                if (outcomes[index] && this.document.version === snapshot.documentVersion) {
                  this.review = createReview(snapshot.source, { documentVersion: snapshot.documentVersion, format: snapshot.format }, mergeSections(outcomes));
                  this.decisions = {};
                }
                this.postState();
              }
            }
          };
          if (total > 1) progress.report({ message: `0 of ${total} sections` });
          await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, total) }, worker));
          if (this.analysis !== job || (job.abort.signal.aborted && !job.editAborted)) return;
          if (job.editAborted || this.document.version !== snapshot.documentVersion) {
            this.restorePrevious(job);
            this.state = this.review ? (job.documentChanged || job.previousState === "modified" ? "modified" : "ready") : "error";
            this.error = { message: "Document changed during analysis. Re-analyze to refresh suggestions.", action: "analyze" };
            return;
          }
          failures.sort((a, b) => a.index - b.index);
          // One request keeps its own failure handling; with several, every failure is counted and the run still ends ready.
          if (failures.length === total && total === 1) throw failures[0].error;
          const discarded = Object.values(job.previousDecisions).filter((decision) => decision !== null).length;
          this.publish(snapshot, mergeSections(outcomes), discarded);
          if (failures.length) {
            this.error = { message: `${failures.length} of ${total} sections could not be analyzed: ${failureText(failures[0].error)}`, action: "analyze" };
          }
        },
      );
    } catch (error) {
      if (!job.abort.signal.aborted && this.analysis === job) {
        this.restorePrevious(job);
        this.state = this.review ? (job.documentChanged || job.previousState === "modified" ? "modified" : "ready") : "error";
        this.error = error instanceof SectionError
          ? { message: error.message }
          : error instanceof ProcessRunnerError
          ? { message: error.message, action: error.kind === "launch" ? "openSettings" : "analyze" }
          : { message: "Analysis failed. Try switching models or retrying.", action: "analyze" };
      }
    } finally {
      if (this.analysis === job) this.analysis = undefined;
      this.postState();
    }
  }

  /** The outcome is otherwise only visible inside the webview; the analyze command returns it for the integration smoke test. */
  status(): { state: ReviewWebviewModel["state"]; error?: string; suggestions: number } {
    return { state: this.state, error: this.error?.message, suggestions: (this.review?.level1.length ?? 0) + (this.review?.level2.length ?? 0) };
  }

  cancelAnalysis(): void {
    const job = this.analysis;
    if (!job) return;
    this.analysis = undefined;
    job.abort.abort();
    this.restorePrevious(job);
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
      clearTimeout(this.typingTimer);
      this.detach()?.dispose();
    } finally {
      this.onDispose();
    }
  }

  private bind(panel: vscode.WebviewPanel): void {
    this.detach();
    this.host = panel;
    this.panelDisposables = [
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
    ];
  }

  /** The first edit after a pause posts at once; a burst of keystrokes then posts its latest state once per interval. */
  private postTypingState(): void {
    if (this.typingTimer) {
      this.typingStatePending = true;
      return;
    }
    this.postState();
    this.typingTimer = setTimeout(() => {
      this.typingTimer = undefined;
      if (this.typingStatePending) this.postTypingState();
    }, TYPING_STATE_INTERVAL_MS);
  }

  private post(message: unknown): void {
    if (this.disposed || !this.host) return;
    void Promise.resolve(this.host.webview.postMessage(message)).catch(() => undefined);
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

  /** Puts back the review that was shown before the run, discarding the sections that finished. */
  private restorePrevious(job: AnalysisJob): void {
    this.review = job.previousReview;
    this.decisions = job.previousDecisions;
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
    this.typingStatePending = false;
    if (this.disposed || !this.host) return;
    const source = this.review?.currentSource ?? this.document.getText();
    const format = this.document.languageId === "markdown" ? "markdown" : "plaintext";
    const blocker = analysisBlocker(source, format);
    const oversized = blocker !== undefined;
    const markdown = !oversized && this.document.languageId === "markdown";
    const tree = markdown ? parseMarkdownTree(source) : undefined;
    const suggestion = (item: Suggestion) => ({
      ...item,
      decision: this.decisions[item.id]?.option ?? null,
      decided: Object.hasOwn(this.decisions, item.id),
    });
    const model: ReviewWebviewModel = {
      documentId: this.document.uri.toString(),
      title: path.basename(this.document.fileName), format,
      currentSource: oversized ? "" : source,
      documentVersion: this.document.version,
      level1: oversized ? [] : this.review?.level1.map(suggestion) ?? [],
      level2: oversized ? [] : this.review?.level2.map(suggestion) ?? [],
      state: this.state, applying: this.applying !== undefined,
      canAnalyze: !oversized && vscode.workspace.isTrusted && this.runner !== undefined && !this.sourceEditing && !this.applying && !this.analysis,
      hasReview: this.review !== undefined,
      canToggleTasks: !oversized && vscode.workspace.isTrusted && this.document.languageId === "markdown" && !this.sourceEditing && !this.applying && !this.analysis,
      tasks: markdown ? markdownTasks(source, tree) : [],
      fences: markdown ? markdownFences(source, tree) : [],
      // The webview drops this slice from every rendered pane; markdown-it has no front-matter rule, so
      // rendering it raw turns "---" into a thematic break and the YAML into a bogus heading (see R5-05).
      frontMatterEnd: oversized || this.document.languageId !== "markdown" ? 0 : (frontMatterRange(source)?.end ?? 0),
      codeFenceLanguages: this.codeFenceLanguages,
      previewTheme: this.previewTheme,
      ...(this.error ? { error: this.error } : blocker ? { error: { message: blocker } } : {}),
      ...(this.analysis?.progress ? { progress: this.analysis.progress } : {}),
      ...(this.notice ? { notice: this.notice } : {}),
    };
    this.post({ type: "state", model });
  }
}

/** Moves a section's suggestions from section-relative offsets to document offsets, with ids that cannot collide across sections. */
function placeInDocument(resolved: ResolvedReview, offset: number, idPrefix: string): ResolvedReview {
  const move = (suggestion: Suggestion): Suggestion => ({ ...suggestion, id: `${idPrefix}${suggestion.id}`, start: suggestion.start + offset, end: suggestion.end + offset });
  return { ...resolved, level1: resolved.level1.map(move), level2: resolved.level2.map(move) };
}

/** The sections finished so far, in document order, as one review. */
function mergeSections(outcomes: ReadonlyArray<ResolvedReview | undefined>): ResolvedReview {
  const done = outcomes.filter((outcome): outcome is ResolvedReview => outcome !== undefined);
  return {
    title: done[0]?.title ?? "",
    level1: done.flatMap((outcome) => outcome.level1),
    level2: done.flatMap((outcome) => outcome.level2),
    skipped: done.reduce((sum, outcome) => sum + outcome.skipped, 0),
  };
}
