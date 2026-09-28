export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

export interface MermaidDiagram { src: string; width: number; }

// ponytail: cache is cleared wholesale past this size; an LRU only matters for huge documents.
const CACHE_LIMIT = 100;

export function mermaidDark(previewTheme: string, bodyClasses: { contains(name: string): boolean }): boolean {
  return previewTheme === "dark"
    || (previewTheme === "auto" && (bodyClasses.contains("vscode-dark") || bodyClasses.contains("vscode-high-contrast")));
}

/**
 * Renders to an <img> data URI: the SVG can't run script, and the draft, suggested, and inline panes
 * can show the same diagram without its element ids (arrow markers, styles) colliding.
 */
function toDiagram(svg: string): MermaidDiagram {
  const width = Number(/viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)/.exec(svg)?.[1]);
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: Number.isFinite(width) && width > 0 ? Math.ceil(width) : 0 };
}

/** Returns a cached diagram synchronously, otherwise a promise; renders run one at a time because mermaid's theme is global. */
export function createMermaidRenderer(load: () => Promise<MermaidApi>) {
  const cache = new Map<string, MermaidDiagram | Promise<MermaidDiagram>>();
  let queue: Promise<unknown> = Promise.resolve();
  let count = 0;
  return (source: string, dark: boolean): MermaidDiagram | Promise<MermaidDiagram> => {
    const key = `${dark ? "dark" : "default"}\n${source}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    const pending = queue.then(async () => {
      const mermaid = await load();
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "default" });
      return toDiagram((await mermaid.render(`sharp-pen-mermaid-${++count}`, source)).svg);
    });
    queue = pending.catch(() => undefined);
    cache.set(key, pending);
    pending.then((diagram) => { if (cache.get(key) === pending) cache.set(key, diagram); }, () => cache.delete(key));
    return pending;
  };
}
