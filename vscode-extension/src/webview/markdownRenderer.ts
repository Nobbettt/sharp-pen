import MarkdownIt from "markdown-it";
const taskLists: any = require("markdown-it-task-lists");

function safeImage(source: string): boolean {
  return /^(?:data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=]+|\.?(?:\/|$))/i.test(source);
}

function safeLink(source: string): boolean {
  let value = source.trim().replace(/[\u0000-\u001f\s]/g, "");
  try { value = decodeURIComponent(value); } catch { /* keep the original value */ }
  return /^(?:https?:|mailto:)/i.test(value) || (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//"));
}

export function createMarkdownRenderer() {
  const renderer = new MarkdownIt({ html: false, linkify: true }).use(taskLists, { enabled: false, label: true });
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
  const image = renderer.renderer.rules.image!;
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = String(token.attrGet("src") || "");
    return safeImage(source) ? image(tokens, index, options, env, self) : renderer.utils.escapeHtml(String(token.content || token.attrGet("alt") || ""));
  };
  return renderer;
}
