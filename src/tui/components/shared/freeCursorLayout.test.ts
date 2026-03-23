import { describe, expect, it } from 'vitest';
import { layoutCursorBlockRow } from './freeCursorLayout.ts';

describe('layoutCursorBlockRow', () => {
  it('keeps width columns and skips the character under the cursor in left/right', () => {
    const p = 'abcdefgh';
    expect(layoutCursorBlockRow(p, 0, 8)).toEqual({
      leftW: 0,
      left: '',
      charUnder: 'a',
      rightW: 7,
      right: 'bcdefgh'.slice(0, 7).padEnd(7, ' '),
    });
    expect(layoutCursorBlockRow(p, 3, 8)).toEqual({
      leftW: 3,
      left: 'abc',
      charUnder: 'd',
      rightW: 4,
      right: 'efgh'.padEnd(4, ' '),
    });
  });

  it('when col is at or past width, mid is blank after width-1 chars', () => {
    const p = 'abcdefgh';
    expect(layoutCursorBlockRow(p, 8, 8)).toEqual({
      leftW: 7,
      left: 'abcdefg',
      charUnder: ' ',
      rightW: 0,
      right: '',
    });
  });
});
