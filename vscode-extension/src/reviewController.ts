import { createHash } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { acceptAll, applyEdits, prepareApply } from "./review/edits";
import { parseReviewIntent, type ReviewIntent } from "./review/intents";
import { reconcileSourceChanges } from "./review/reconcile";
import type { Decision, Decisions, Level, Review, ResolvedReview, Suggestion } from "./review/types";
import { REVIEW_LIMITS, assertReviewSource, createReview, validateAndResolve } from "./review/validate";
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

/** A published review is current until VS Code reports a newer document version. */
export function canAnalyzeReview(
  review: Pick<Review, "analysisDocumentVersion" | "currentDocumentVersion"> | undefined,
  retryableAnalysisError = false,
): boolean {
  return retryableAnalysisError || !review || review.currentDocumentVersion !== review.analysisDocumentVersion;
}

export class ReviewController implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private review: Review | undefined;
  private decisions: Decisions = {};
  private state: ReviewWebviewModel["state"] = "empty";
  private error: ReviewWebviewModel["error"] | undefined;
  private analysis: AnalysisJob | undefined;
  private applying: ApplyJob | undefined;
  private disposed = false;
  private readonly disposables: vscode.Disposable[];

  constructor(
    readonly document: vscode.TextDocument,
    extensionUri: vscode.Uri,
    private readonly runner: AnalysisRunner | undefined,
    private readonly onDispose: () => void,
    column: vscode.ViewColumn,
    private previewTheme: PreviewTheme = "light",
  ) {
    this.panel = vscode.window.createWebviewPanel("sharpPen.review", `Sharp Pen: ${path.basename(document.fileName)}`, column, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    this.panel.webview.html = reviewWebviewHtml(this.panel.webview, extensionUri);
    this.disposables = [
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
    ];
  }

  reveal(column: vscode.ViewColumn): void {
    this.panel.reveal(column, true);
  }

  setPreviewTheme(previewTheme: PreviewTheme): void {
    this.previewTheme = previewTheme;
    this.postState();
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.toString() !== this.document.uri.toString()) return;
    if (this.analysis) this.analysis.documentChanged = true;
    const source = event.document.getText();
    if (this.applying) {
      if (event.document.version === this.applying.resultVersion && source === this.applying.result) {
        this.applying.sawExpectedChange = true;
        return;
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

  async analyze(): Promise<void> {
    if (this.applying) return;
    if (this.analysis) return this.cancelAnalysis();
    if (!this.canAnalyze()) return;
    if (!vscode.workspace.isTrusted) return this.fail("Trust this workspace before running Sharp Pen analysis.");
    if (!this.runner) return this.fail("Analysis is not connected yet.", "openSettings");
    const snapshot = this.snapshot();
    try {
      assertReviewSource(snapshot.source);
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Document is too large to analyze.");
    }
    const job: AnalysisJob = { abort: new AbortController(), previousState: this.state, previousError: this.error, documentChanged: false };
    this.analysis = job;
    this.state = "analyzing";
    this.error = undefined;
    this.postState();
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Sharp Pen is analyzing", cancellable: true },
        async (_progress, token) => {
          token.onCancellationRequested(() => {
            if (this.analysis === job) this.cancelAnalysis();
            else job.abort.abort();
          });
          const result = await this.runner!(snapshot, job.abort.signal);
          if (job.abort.signal.aborted || this.analysis !== job) return;
          if (this.document.version !== snapshot.documentVersion) throw new Error("Document changed during analysis. Re-analyze it to refresh suggestions.");
          const resolved = validateAndResolve(snapshot.source, result, snapshot.format);
          this.publish(snapshot, resolved);
        },
      );
    } catch (error) {
      if (!job.abort.signal.aborted && this.analysis === job) {
        this.state = this.review ? (job.documentChanged || job.previousState === "modified" ? "modified" : "ready") : "error";
        this.error = { message: error instanceof Error ? error.message : "Sharp Pen analysis failed.", action: "analyze" };
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
    this.state = job.previousState;
    this.error = job.previousError;
    this.postState();
  }

  async apply(): Promise<void> {
    if (this.applying || this.analysis || !this.review) return;
    const document = this.document;
    const source = document.getText();
    const version = document.version;
    const prepared = prepareApply(this.review, this.decisions, source, version);
    this.review = prepared.review;
    this.decisions = prepared.decisions;
    if (!prepared.canApply) return this.postState();
    if (!prepared.edits.length) return this.postState();
    const job: ApplyJob = {
      source,
      version,
      result: applyEdits(source, prepared.edits),
      resultVersion: version + 1,
      sawExpectedChange: false,
      conflicted: false,
    };
    this.applying = job;
    this.postState();
    try {
      const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === document.uri.toString())
        ?? await vscode.window.showTextDocument(document, { preserveFocus: true, preview: false });
      if (document.version !== job.version || document.getText() !== job.source) {
        this.state = "modified";
        this.error = {
          message: "Document changed before Sharp Pen applied staged changes. Review remains open; re-analyze before applying again.",
          action: "analyze",
        };
        return;
      }
      const applied = await editor.edit((builder) => {
        for (const item of prepared.edits) {
          builder.replace(new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)), item.text);
        }
      }, { undoStopBefore: true, undoStopAfter: true });
      if (!applied || job.conflicted || !job.sawExpectedChange || document.version !== job.resultVersion || document.getText() !== job.result) {
        const conflicted = job.conflicted || document.version !== job.version || document.getText() !== job.source;
        if (conflicted) {
          this.state = "modified";
          this.error = {
            message: "Document changed while Sharp Pen applied staged changes. Review remains open; verify it and re-analyze before applying again.",
            action: "analyze",
          };
        } else {
          this.error = { message: "Sharp Pen could not apply the staged changes. Try Apply again.", action: "apply" };
        }
        return;
      }
      this.review = undefined;
      this.decisions = {};
      this.state = "applied";
      this.error = undefined;
    } catch (error) {
      const conflicted = job.conflicted || document.version !== job.version || document.getText() !== job.source;
      if (conflicted) {
        this.state = "modified";
        this.error = {
          message: "Document changed while Sharp Pen applied staged changes. Review remains open; verify it and re-analyze before applying again.",
          action: "analyze",
        };
      } else {
        this.error = {
          message: `Sharp Pen could not apply the staged changes${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
          action: "apply",
        };
      }
    } finally {
      if (this.applying === job) this.applying = undefined;
      this.postState();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAnalysis();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.panel.dispose();
    this.onDispose();
  }

  private receive(message: unknown): void {
    const intent = parseReviewIntent(message);
    if (!intent) return;
    switch (intent.type) {
      case "ready": return this.postState();
      case "analyze": void this.analyze(); return;
      case "cancel": return this.cancelAnalysis();
      case "choose": return this.choose(intent);
      case "acceptAll": return this.acceptAll(intent.level);
      case "reset": return this.reset(intent.level);
      case "apply": void this.apply(); return;
      case "openSettings": void vscode.commands.executeCommand("sharpPen.openSettings"); return;
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

  private publish(snapshot: AnalysisRequest, resolved: ResolvedReview): void {
    this.review = createReview(snapshot.source, {
      uri: snapshot.uri, documentVersion: snapshot.documentVersion,
      sourceHash: createHash("sha256").update(snapshot.source).digest("hex"),
      format: snapshot.format,
    }, resolved);
    this.decisions = {};
    this.state = "ready";
    this.error = undefined;
  }

  private fail(message: string, action?: "openSettings" | "analyze" | "apply"): void {
    this.state = this.review ? (this.state === "modified" ? "modified" : "ready") : "error";
    this.error = { message, ...(action ? { action } : {}) };
    this.postState();
  }

  private postState(): void {
    const source = this.review?.currentSource ?? this.document.getText();
    const oversized = source.length > REVIEW_LIMITS.source;
    const suggestion = (item: Suggestion) => ({
      ...item,
      decision: this.decisions[item.id]?.option ?? null,
      decided: Object.hasOwn(this.decisions, item.id),
    });
    const model: ReviewWebviewModel = {
      title: path.basename(this.document.fileName), format: this.document.languageId === "markdown" ? "markdown" : "plaintext",
      currentSource: oversized ? "" : source,
      level1: oversized ? [] : this.review?.level1.map(suggestion) ?? [],
      level2: oversized ? [] : this.review?.level2.map(suggestion) ?? [],
      state: this.state, applying: this.applying !== undefined,
      canAnalyze: !oversized && vscode.workspace.isTrusted && this.runner !== undefined && !this.applying && !this.analysis && this.canAnalyze(),
      previewTheme: this.previewTheme,
      ...(this.error ? { error: this.error } : oversized ? { error: { message: `Document exceeds the ${REVIEW_LIMITS.source.toLocaleString()}-character preview and analysis limit.` } } : {}),
    };
    void this.panel.webview.postMessage({ type: "state", model });
  }

  private canAnalyze(): boolean {
    return canAnalyzeReview(this.review, this.error?.action === "analyze");
  }
}
