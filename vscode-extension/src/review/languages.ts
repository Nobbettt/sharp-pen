import * as vscode from "vscode";
import { highlightableInstalledLanguageIds } from "./fenceHighlight";

// Match VS Code's Markdown preview languages, including agent customizations.
const markdownLanguages = new Set(["markdown", "prompt", "instructions", "chatagent", "skill"]);

export function isMarkdownDocument(document: Pick<vscode.TextDocument, "languageId" | "fileName">): boolean {
  return markdownLanguages.has(document.languageId) || /\.md$/i.test(document.fileName);
}

export function isSupportedDocument(document: Pick<vscode.TextDocument, "languageId" | "fileName">): boolean {
  return document.languageId === "plaintext" || isMarkdownDocument(document);
}

let cached: Promise<readonly string[]> | undefined;

export function isFenceLanguageId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && !/[\s\u0000-\u001f\u007f`~]/.test(id);
}

/** VS Code is the sole language catalog; cache its installed IDs for this extension session. */
export function installedLanguageIds(): Promise<readonly string[]> {
  cached ??= Promise.resolve(vscode.languages.getLanguages()).then((ids) => highlightableInstalledLanguageIds(ids.filter(isFenceLanguageId)));
  return cached;
}
