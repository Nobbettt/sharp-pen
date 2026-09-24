import * as vscode from "vscode";
import { highlightableInstalledLanguageIds } from "./fenceHighlight";

let cached: Promise<readonly string[]> | undefined;

export function isFenceLanguageId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && !/[\s\u0000-\u001f\u007f`~]/.test(id);
}

/** VS Code is the sole language catalog; cache its installed IDs for this extension session. */
export function installedLanguageIds(): Promise<readonly string[]> {
  cached ??= Promise.resolve(vscode.languages.getLanguages()).then((ids) => highlightableInstalledLanguageIds(ids.filter(isFenceLanguageId)));
  return cached;
}
