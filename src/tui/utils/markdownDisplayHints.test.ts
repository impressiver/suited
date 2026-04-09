import { describe, expect, it } from 'vitest';
import { markdownDisplayCharMap, wrappedMarkdownHintRows } from './markdownDisplayHints.tsx';
import { linesToWrappedRows, splitLinesForWrap } from './wrapTextRows.ts';

describe('wrappedMarkdownHintRows', () => {
  it('matches linesToWrappedRows row count for mixed markdown', () => {
    const md = [
      '# One',
      '## Two **bold** tail',
      '',
      '> quote with `code`',
      '- item *italic*',
      `plain long ${'word '.repeat(20).trimEnd()}`,
    ].join('\n');
    const lines = splitLinesForWrap(md);
    const w = 24;
    const plain = linesToWrappedRows(lines, w);
    const hinted = wrappedMarkdownHintRows(lines, w);
    expect(hinted.length).toBe(plain.length);
  });

  it('matches for empty document', () => {
    const lines = splitLinesForWrap('');
    const w = 10;
    expect(wrappedMarkdownHintRows(lines, w).length).toBe(linesToWrappedRows(lines, w).length);
  });
});

describe('markdownDisplayCharMap', () => {
  it('maps bold inner text to source columns (syntax not in display)', () => {
    const m = markdownDisplayCharMap('**ab**');
    expect(m.map((c) => c.ch).join('')).toBe('ab');
    expect(m.map((c) => c.rawCol)).toEqual([2, 3]);
    expect(m.every((c) => c.style.bold === true)).toBe(true);
  });

  it('maps heading prefix and title', () => {
    const m = markdownDisplayCharMap('## Hi');
    expect(m.map((c) => c.ch).join('')).toBe('## Hi');
    expect(m[0]?.style.dim && m[1]?.style.dim && m[2]?.style.dim).toBe(true);
    expect(m[3]?.ch).toBe('H');
    expect(m[3]?.style.dim).toBeFalsy();
  });

  it('maps list marker dim and body', () => {
    const m = markdownDisplayCharMap('- x');
    expect(m.map((c) => c.ch).join('')).toBe('- x');
    expect(m[0]?.style.dim && m[1]?.style.dim).toBe(true);
    expect(m[2]?.ch).toBe('x');
    expect(m[2]?.style.dim).toBeFalsy();
  });
});
