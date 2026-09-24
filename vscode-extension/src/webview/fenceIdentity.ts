export function cleanFenceIdentityText(text: string, marker: RegExp): string {
  marker.lastIndex = 0;
  return text.replace(marker, "");
}
