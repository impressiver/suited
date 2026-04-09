import { describe, expect, it } from 'vitest';
import { coverLetterMarkdownToHtml, normalizeCoverLetterNewlines } from './markdownToHtml.ts';

describe('normalizeCoverLetterNewlines', () => {
  it('normalizes CRLF and CR', () => {
    expect(normalizeCoverLetterNewlines('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('coverLetterMarkdownToHtml', () => {
  it('renders paragraphs and bold', () => {
    const html = coverLetterMarkdownToHtml('Hello **world**.\n\nSecond.');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<p>');
  });

  it('renders unordered lists', () => {
    const html = coverLetterMarkdownToHtml('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  it('strips raw HTML tags from input', () => {
    const html = coverLetterMarkdownToHtml('Hi <script>x</script>there');
    expect(html).not.toContain('<script>');
    expect(html).toContain('there');
  });
});
