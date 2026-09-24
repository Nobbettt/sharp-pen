export function cleanTaskMarkers(text: string, marker: RegExp): string {
  marker.lastIndex = 0;
  return text.replace(marker, "");
}

export function taskControlsMatch(sourceTasks: number, mappedTasks: number, renderedInputs: number, valid: boolean): boolean {
  return valid && sourceTasks === mappedTasks && renderedInputs === mappedTasks;
}
