export const previewZoom = { minimum: 50, maximum: 200, step: 10, default: 100 } as const;

export function normalizePreviewZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return previewZoom.default;
  return Math.max(previewZoom.minimum, Math.min(previewZoom.maximum, Math.round(value)));
}
