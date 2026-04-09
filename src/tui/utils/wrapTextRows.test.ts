import { describe, expect, it } from 'vitest';
import {
  linesToWrappedRows,
  splitLinesForWrap,
  wrapLineToRows,
  wrappedScrollMax,
} from './wrapTextRows.ts';

describe('wrapLineToRows', () => {
  it('returns single empty row for empty string', () => {
    expect(wrapLineToRows('', 10)).toEqual(['']);
  });

  it('splits long unbroken tokens', () => {
    expect(wrapLineToRows('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('wraps on spaces when possible', () => {
    expect(wrapLineToRows('hello world wide', 10)).toEqual(['hello', 'world wide']);
  });

  it('strips carriage returns (would reset terminal column and break borders)', () => {
    expect(wrapLineToRows('a\rb', 10)).toEqual(['ab']);
  });
});

describe('splitLinesForWrap', () => {
  it('normalizes CRLF and lone CR to newlines', () => {
    expect(splitLinesForWrap('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });
});

describe('linesToWrappedRows', () => {
  it('flattens multiple logical lines', () => {
    expect(linesToWrappedRows(['a b', 'c'], 80)).toEqual(['a b', 'c']);
  });

  it('preserves blank lines as an empty row', () => {
    expect(linesToWrappedRows(['hi', '', 'yo'], 10)).toEqual(['hi', '', 'yo']);
  });
});

describe('wrappedScrollMax', () => {
  it('returns 0 when everything fits', () => {
    expect(wrappedScrollMax(['a', 'b'], 5, 10)).toBe(0);
  });

  it('accounts for wrapped overflow', () => {
    const lines = ['x'.repeat(30)];
    expect(wrappedScrollMax(lines, 2, 10)).toBeGreaterThan(0);
  });
});
