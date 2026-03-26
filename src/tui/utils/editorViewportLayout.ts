import type { DOMElement } from 'ink';
import { offsetAtLineCol } from '../textBufferCursor.ts';

/**
 * Sum Yoga layout offsets from this node up to the Ink root so mouse cell coords
 * (0-based from top-left of the terminal area Ink owns) can be compared to SGR px/py.
 * For {@link bufferOffsetInEditorViewport}, `frame` should be the **first visible editor line’s**
 * `Box` (sum of layout offsets matches Ink’s `renderNodeToOutput` for that row), not a generic wrapper.
 */
export function getDomElementScreenRect(el: DOMElement | null): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (el?.yogaNode == null) {
    return null;
  }
  let left = 0;
  let top = 0;
  let cur: DOMElement | undefined = el;
  while (cur != null) {
    const y = cur.yogaNode;
    if (y != null) {
      left += Math.round(y.getComputedLeft());
      top += Math.round(y.getComputedTop());
    }
    cur = cur.parentNode;
  }
  const y = el.yogaNode;
  return {
    left,
    top,
    width: Math.round(y.getComputedWidth()),
    height: Math.round(y.getComputedHeight()),
  };
}

/**
 * Map a terminal cell (0-based, aligned with Yoga + SGR px/py) to a buffer offset
 * inside the logical-line editor viewport, or `null` if outside the text area.
 *
 * `frame` is the screen rect of the **first visible logical line** (top-left cell of row 0 in
 * the viewport), from {@link getDomElementScreenRect} on that line’s `Box`.
 */
export function bufferOffsetInEditorViewport(
  px: number,
  py: number,
  frame: { left: number; top: number },
  textCols: number,
  viewportHeight: number,
  scrollLine: number,
  text: string,
): number | null {
  const originX = frame.left;
  const originY = frame.top;
  const localX = px - originX;
  const localY = py - originY;
  if (localX < 0 || localX >= textCols || localY < 0) {
    return null;
  }
  const lines = text.split('\n');
  const rowsBelowScroll = Math.max(0, lines.length - scrollLine);
  const visibleRows = Math.min(viewportHeight, rowsBelowScroll);
  if (localY >= visibleRows) {
    return null;
  }
  const globalLine = scrollLine + localY;
  if (globalLine < 0 || globalLine >= lines.length) {
    return null;
  }
  const row = lines[globalLine] ?? '';
  const col = Math.min(localX, row.length);
  return offsetAtLineCol(text, globalLine, col);
}
