/**
 * Approximate inner width of the main panel for wrapping multiline text.
 * Matches `Layout` padding (1+1) + `Sidebar` (22) + `marginRight` (2).
 */
export function panelInnerWidth(terminalCols: number): number {
  return Math.max(20, terminalCols - 26);
}
