import { describe, expect, it } from 'vitest';
import { parseSgrMouseEvent, sgrMouseWheelLinesDelta } from './sgrMouseWheel.ts';

describe('parseSgrMouseEvent', () => {
  it('returns null for non-mouse input', () => {
    expect(parseSgrMouseEvent('a')).toBeNull();
    expect(parseSgrMouseEvent('\u001b[A')).toBeNull();
  });

  it('accepts Ink-style input with leading ESC stripped (useInput)', () => {
    expect(parseSgrMouseEvent('[<65;92;14M')).toEqual({
      kind: 'wheel',
      delta: 3,
    });
    expect(parseSgrMouseEvent('[<64;1;1M')).toEqual({
      kind: 'wheel',
      delta: -3,
    });
    expect(parseSgrMouseEvent('[<0;54;8M')).toEqual({
      kind: 'pointer',
      px: 53,
      py: 7,
      released: false,
      leftPress: true,
      leftDrag: false,
    });
    expect(parseSgrMouseEvent('[<32;54;8M')).toEqual({
      kind: 'pointer',
      px: 53,
      py: 7,
      released: false,
      leftPress: false,
      leftDrag: true,
    });
    expect(parseSgrMouseEvent('[<0;54;8m')).toEqual({
      kind: 'pointer',
      px: 53,
      py: 7,
      released: true,
      leftPress: false,
      leftDrag: false,
    });
  });

  it('accepts full CSI with ESC prefix', () => {
    expect(parseSgrMouseEvent('\u001b[<65;5;10M')).toEqual({
      kind: 'wheel',
      delta: 3,
    });
  });

  it('treats middle button as other', () => {
    expect(parseSgrMouseEvent('[<1;5;5M')).toEqual({ kind: 'other' });
  });
});

describe('sgrMouseWheelLinesDelta', () => {
  it('returns null for non-wheel mouse', () => {
    expect(sgrMouseWheelLinesDelta('[<0;54;8M')).toBeNull();
    expect(sgrMouseWheelLinesDelta('[<0;54;8m')).toBeNull();
  });

  it('detects wheel up and down with or without ESC', () => {
    expect(sgrMouseWheelLinesDelta('\u001b[<64;5;10M')).toBe(-3);
    expect(sgrMouseWheelLinesDelta('[<65;5;10M')).toBe(3);
  });
});
