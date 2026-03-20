/** Spec: stacked below 80 cols, two-panel at 80+. */
export const JOBS_SPLIT_PANE_MIN_COLS = 80;

export function jobsUseSplitPane(stdoutColumns: number): boolean {
  return stdoutColumns >= JOBS_SPLIT_PANE_MIN_COLS;
}

export function jobsListPaneWidth(totalCols: number): number {
  if (!jobsUseSplitPane(totalCols)) {
    return totalCols;
  }
  return Math.min(46, Math.max(28, Math.floor(totalCols * 0.4)));
}
