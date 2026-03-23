/**
 * Block cursor layout: exactly `width` columns with a single-cell “mid” that
 * replaces `padded[col]` (not inserted before it), so blink can toggle mid-cell
 * style without shifting neighbors.
 */
export function layoutCursorBlockRow(
  padded: string,
  col: number,
  width: number,
): {
  leftW: number;
  left: string;
  charUnder: string;
  rightW: number;
  right: string;
} {
  const c = Math.min(Math.max(0, col), width);
  if (c >= width) {
    const leftW = Math.max(0, width - 1);
    return {
      leftW,
      left: padded.slice(0, leftW).padEnd(leftW, ' '),
      charUnder: ' ',
      rightW: 0,
      right: '',
    };
  }
  const leftW = c;
  const rightW = width - c - 1;
  const charUnder = padded[c] ?? ' ';
  return {
    leftW,
    left: padded.slice(0, leftW).padEnd(leftW, ' '),
    charUnder,
    rightW,
    right: padded.slice(c + 1, c + 1 + rightW).padEnd(rightW, ' '),
  };
}
