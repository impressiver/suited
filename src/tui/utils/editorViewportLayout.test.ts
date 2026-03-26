import { describe, expect, it } from 'vitest';
import { bufferOffsetInEditorViewport } from './editorViewportLayout.ts';

describe('bufferOffsetInEditorViewport', () => {
  it('maps cell inside text to buffer offset (content origin = first text cell)', () => {
    const text = 'ab\ncd';
    const frame = { left: 5, top: 3 };
    const off = bufferOffsetInEditorViewport(6, 3, frame, 4, 2, 0, text);
    expect(off).toBe(1);
  });

  it('returns null outside text columns', () => {
    const text = 'x';
    expect(bufferOffsetInEditorViewport(10, 3, { left: 5, top: 3 }, 4, 2, 0, text)).toBeNull();
  });
});
