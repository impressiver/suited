/**
 * Small Markdown subset for cover letters (specs/cover-letter-pdf.md §4.1).
 * Raw HTML in source is escaped; no unescaped tags in output.
 */

export function normalizeCoverLetterNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip or escape HTML tags from raw markdown (treat as plain text). */
export function stripOrEscapeRawHtmlInMarkdown(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function inlineMarkdownToHtml(line: string): string {
  let s = escapeHtml(line);

  s = s.replace(/`([^`]+)`/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`);

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(^|\s)_([^_\n]+)_($|\s)/g, '$1<em>$2</em>$3');

  s = s.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const lt = escapeHtml(String(label));
    const ut = escapeHtml(String(url));
    return `${lt} (${ut})`;
  });

  return s;
}

function formatParagraphBlock(raw: string): string {
  const lines = raw.split('\n');
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const piece = inlineMarkdownToHtml(lines[i] ?? '');
    parts.push(piece);
    if (i < lines.length - 1) {
      parts.push('<br>\n');
    }
  }
  return `<p>${parts.join('')}</p>\n`;
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trimStart());
}

function headingToHtml(line: string): string {
  const t = line.trim();
  const m = /^#{1,6}\s+(.*)$/.exec(t);
  if (!m) return formatParagraphBlock(line);
  const level = Math.min(6, line.trimStart().match(/^#+/)?.[0].length ?? 1);
  const inner = inlineMarkdownToHtml(m[1].trim());
  return `<h${level}>${inner}</h${level}>\n`;
}

/**
 * Convert cover letter Markdown subset to HTML body fragments (no outer wrapper).
 */
export function coverLetterMarkdownToHtml(markdown: string): string {
  const text = stripOrEscapeRawHtmlInMarkdown(normalizeCoverLetterNewlines(markdown)).trim();
  if (!text) {
    return '';
  }

  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
    const trimmedLines = lines.map((l) => l.trimEnd());
    const nonEmpty = trimmedLines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) {
      continue;
    }

    const first = nonEmpty[0] ?? '';
    if (isHeadingLine(first) && nonEmpty.length === 1) {
      out.push(headingToHtml(first));
      continue;
    }

    const ul = nonEmpty.every((l) => /^[-*]\s/.test(l));
    if (ul) {
      out.push('<ul>\n');
      for (const l of nonEmpty) {
        const item = l.replace(/^[-*]\s/, '');
        out.push(`  <li>${inlineMarkdownToHtml(item)}</li>\n`);
      }
      out.push('</ul>\n');
      continue;
    }

    const ol = nonEmpty.every((l) => /^\d+\.\s/.test(l));
    if (ol) {
      out.push('<ol>\n');
      for (const l of nonEmpty) {
        const item = l.replace(/^\d+\.\s/, '');
        out.push(`  <li>${inlineMarkdownToHtml(item)}</li>\n`);
      }
      out.push('</ol>\n');
      continue;
    }

    out.push(formatParagraphBlock(block));
  }

  return out.join('');
}
