import { describe, expect, it } from 'vitest';
import { computeMarkdownEditorScrollThumb } from './MarkdownEditorScrollGutter.tsx';

describe('computeMarkdownEditorScrollThumb', () => {
  it('returns zero thumb when everything fits', () => {
    expect(computeMarkdownEditorScrollThumb(10, 0, 5)).toEqual({
      maxScroll: 0,
      thumbStart: 0,
      thumbH: 0,
    });
  });

  it('keeps thumb within the track and moves with scroll', () => {
    const vp = 10;
    const total = 100;
    const top = computeMarkdownEditorScrollThumb(vp, 0, total);
    expect(top.thumbH).toBe(1);
    expect(top.thumbStart).toBe(0);

    const bottom = computeMarkdownEditorScrollThumb(vp, 90, total);
    expect(bottom.thumbStart).toBe(9);
    expect(bottom.thumbStart + bottom.thumbH).toBeLessThanOrEqual(vp);
  });
});
