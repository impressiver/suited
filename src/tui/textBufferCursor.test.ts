import { describe, expect, it } from 'vitest';
import {
  lineColAtOffset,
  offsetAtLineCol,
  offsetDown,
  offsetLeft,
  offsetRight,
  offsetUp,
} from './textBufferCursor.ts';

describe('textBufferCursor', () => {
  it('lineColAtOffset and offsetAtLineCol round-trip', () => {
    const t = 'ab\ncde\n';
    expect(lineColAtOffset(t, 0)).toEqual({ line: 0, col: 0 });
    expect(lineColAtOffset(t, 2)).toEqual({ line: 0, col: 2 });
    expect(lineColAtOffset(t, 3)).toEqual({ line: 1, col: 0 });
    expect(offsetAtLineCol(t, 1, 2)).toBe(5);
  });

  it('offsetUp and offsetDown preserve column when possible', () => {
    const t = 'hi\nx\n';
    const afterFirst = offsetAtLineCol(t, 1, 0);
    expect(offsetUp(t, afterFirst)).toBe(0);
    expect(offsetDown(t, 0)).toBe(3);
  });

  it('offsetLeft and offsetRight clamp at bounds', () => {
    expect(offsetLeft('a', 0)).toBe(0);
    expect(offsetRight('a', 1)).toBe(1);
  });
});
