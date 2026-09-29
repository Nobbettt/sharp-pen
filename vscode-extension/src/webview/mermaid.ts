export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string, container?: Element): Promise<{ svg: string }>;
}

export interface MermaidDiagram { src: string; width: number; alt: string; }

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
  // Mermaid tags the SVG with its diagram type (e.g. "flowchart-v2", "sequence"); the <img> loses the SVG's own a11y tree.
  const type = /aria-roledescription="([\w-]+)"/.exec(svg)?.[1].replace(/-v\d+$/, "").replace(/Diagram$/, "");
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: Number.isFinite(width) && width > 0 ? Math.ceil(width) : 0,
    alt: type ? `Mermaid ${type.toLowerCase()} diagram` : "Mermaid diagram",
  };
}

/**
 * Returns a cached diagram synchronously, otherwise a promise; renders run one at a time because mermaid's theme is global.
 * `host` is where mermaid lays diagrams out to measure them; without it mermaid appends a full-size
 * element to <body>, which shifts the whole review layout until each render finishes.
 * `wanted` says whether a caller still shows the diagram. A queued render nobody still wants is skipped,
 * so typing in a fence (a new source every update) doesn't build a backlog of stale renders.
 */
export function createMermaidRenderer(load: () => Promise<MermaidApi>, host?: () => Element) {
  const cache = new Map<string, MermaidDiagram | Promise<MermaidDiagram>>();
  let queue: Promise<unknown> = Promise.resolve();
  const waiting = new Map<string, Array<() => boolean>>();
  let count = 0;
  return (source: string, dark: boolean, wanted: () => boolean = () => true): MermaidDiagram | Promise<MermaidDiagram> => {
    const key = `${dark ? "dark" : "default"}\n${source}`;
    const cached = cache.get(key);
    if (cached) {
      waiting.get(key)?.push(wanted);
      return cached;
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    const wants = [wanted];
    waiting.set(key, wants);
    const pending = queue.then(async () => {
      if (waiting.get(key) === wants) waiting.delete(key);
      if (!wants.some((wantedBy) => wantedBy())) throw new Error("Mermaid render superseded");
      const mermaid = await load();
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "default" });
      return toDiagram((await mermaid.render(`sharp-pen-mermaid-${++count}`, source, host?.())).svg);
    });
    queue = pending.catch(() => undefined);
    cache.set(key, pending);
    pending.then((diagram) => { if (cache.get(key) === pending) cache.set(key, diagram); }, () => cache.delete(key));
    return pending;
  };
}
