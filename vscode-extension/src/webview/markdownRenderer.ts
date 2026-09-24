import MarkdownIt from "markdown-it";
import { highlightCode, type HighlightBudget } from "./codeHighlight";
const taskLists: any = require("markdown-it-task-lists");

// The webview has no <base> and no local resource root for the document's own directory, so a
// relative path cannot resolve to anything but a broken image; only inline data URIs can render.
function safeImage(source: string): boolean {
  return /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=]+/i.test(source);
}

function safeLink(source: string): boolean {
  let value = source.trim().replace(/[\u0000-\u001f\s]/g, "");
  try { value = decodeURIComponent(value); } catch { /* keep the original value */ }
  return /^(?:https?:|mailto:)/i.test(value) || (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//"));
}

export function createMarkdownRenderer() {
  const renderer = new MarkdownIt({ html: false, linkify: true }).use(taskLists, { enabled: false, label: false });
  // Bare domains and emails aren't excluded from review (see validate.ts's literalUrlPattern),
  // so linkify must only recognize the same <https://...> / autolink syntax the review does.
  renderer.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
  for (const rule of ["th_open", "td_open"]) renderer.renderer.rules[rule] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const styleIndex = token.attrIndex("style");
    const alignment = /^text-align:(left|right|center)$/.exec(String(token.attrGet("style") ?? ""))?.[1];
    if (styleIndex >= 0) token.attrs!.splice(styleIndex, 1);
    if (alignment) token.attrJoin("class", `markdown-align-${alignment}`);
    return self.renderToken(tokens, index, options);
  };
  // Parse every link so its label survives; rendering below makes links inert.
  renderer.validateLink = () => true;
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const destination = String(token.attrGet("href") || "");
    token.tag = "span";
    token.attrs = [["class", "markdown-link"]];
    if (safeLink(destination)) token.attrSet("title", destination);
    return self.renderToken(tokens, index, options);
  };
  renderer.renderer.rules.link_close = () => "</span>";
  renderer.renderer.rules.fence = (tokens, index, _options, env) => {
    const token = tokens[index];
    let identity = "";
    const info = String(token.info || "").replace(/\s*(\uE004sharp-pen-fence-[0-9a-f-]+\uE005)(\d+)\1/g, (_match, namespace, fenceIndex) => {
      identity = `${namespace}${fenceIndex}${namespace}`;
      return " ";
    });
    const language = /^\s*(\S+)/.exec(info)?.[1].toLowerCase() ?? "";
    const state = (env ?? {}) as Record<string, unknown>;
    const fenceIndex = Number.isSafeInteger(state.sharpPenFenceIndex) ? state.sharpPenFenceIndex as number : 0;
    state.sharpPenFenceIndex = fenceIndex + 1;
    const escapedLanguage = renderer.utils.escapeHtml(language);
    const budget = (state.sharpPenHighlightBudget ??= { attempted: 0 }) as HighlightBudget;
    const highlighted = highlightCode(token.content, language, budget);
    const codeClass = language ? ` class="language-${escapedLanguage}${highlighted.highlighted ? " hljs" : ""}"` : "";
    const identityAttribute = identity ? ` data-sharp-pen-fence-identity="${renderer.utils.escapeHtml(identity)}"` : "";
    return `<pre data-sharp-pen-fence-index="${fenceIndex}" data-sharp-pen-fence-language="${escapedLanguage}"${identityAttribute}><code${codeClass}>${highlighted.html}</code></pre>\n`;
  };
  const image = renderer.renderer.rules.image!;
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = String(token.attrGet("src") || "");
    return safeImage(source) ? image(tokens, index, options, env, self) : renderer.utils.escapeHtml(String(token.content || token.attrGet("alt") || ""));
  };
  return renderer;
}
