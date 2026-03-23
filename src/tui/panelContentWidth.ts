/**
 * Approximate inner width of the main panel for wrapping multiline text.
 * Matches `DocumentShell` horizontal padding (1 char each side on the outer `Layout` box).
 */
export function panelInnerWidth(terminalCols: number): number {
  return Math.max(20, terminalCols - 2);
}

/**
 * Text columns inside a `TextViewport` round/single border (one column each side).
 * Use for `linesToWrappedRows` / `padToWidth`; pass `panelInnerWidth` as the frame's `panelWidth`.
 */
export function panelFramedTextWidth(terminalCols: number): number {
  return Math.max(12, panelInnerWidth(terminalCols) - 2);
}

/**
 * Row count for a scroll viewport or multiline editor inside the main panel.
 * `reservedRows` is everything above/below the viewport (header, banner, titles, hints, footer slack).
 */
export function panelContentViewportRows(terminalRows: number, reservedRows: number): number {
  return Math.max(4, Math.min(72, terminalRows - reservedRows));
}
