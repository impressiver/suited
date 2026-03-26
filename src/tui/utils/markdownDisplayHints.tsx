import { Box, Text } from 'ink';
import type { ReactElement } from 'react';

export type MdHintStyle = { bold?: boolean; dim?: boolean; italic?: boolean };
export type MdHintRun = { text: string } & MdHintStyle;

function sameStyle(a: MdHintRun, b: MdHintStyle): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.dim) === Boolean(b.dim) &&
    Boolean(a.italic) === Boolean(b.italic)
  );
}

function mergeAdjacentRuns(runs: MdHintRun[]): MdHintRun[] {
  const out: MdHintRun[] = [];
  for (const r of runs) {
    if (r.text === '') {
      continue;
    }
    const prev = out[out.length - 1];
    if (prev !== undefined && sameStyle(prev, r)) {
      prev.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function parseInlineToRuns(s: string): MdHintRun[] {
  const out: MdHintRun[] = [];
  let i = 0;
  while (i < s.length) {
    const slice = s.slice(i);
    const code = slice.match(/^`([^`]*)`/);
    if (code !== null && code[0] !== undefined) {
      out.push({ text: code[1] ?? '', dim: true });
      i += code[0].length;
      continue;
    }
    const bold = slice.match(/^\*\*([^*]+)\*\*/);
    if (bold !== null && bold[0] !== undefined) {
      out.push({ text: bold[1] ?? '', bold: true });
      i += bold[0].length;
      continue;
    }
    const italic = slice.match(/^\*([^*]+)\*/);
    if (italic !== null && italic[0] !== undefined) {
      out.push({ text: italic[1] ?? '', italic: true });
      i += italic[0].length;
      continue;
    }
    const next = slice.search(/[`*]/);
    if (next === -1) {
      out.push({ text: slice });
      break;
    }
    if (next > 0) {
      out.push({ text: slice.slice(0, next) });
      i += next;
      continue;
    }
    out.push({ text: slice[0] ?? '' });
    i += 1;
  }
  return mergeAdjacentRuns(out);
}

/** One visible character after markdown-hint stripping, mapped to a source column in the raw line. */
export type MdDisplayChar = { ch: string; style: MdHintStyle; rawCol: number };

function pushPlainSliceAsChars(
  out: MdDisplayChar[],
  slice: string,
  baseCol: number,
  style: MdHintStyle,
): void {
  for (let k = 0; k < slice.length; k++) {
    out.push({ ch: slice[k] ?? ' ', style, rawCol: baseCol + k });
  }
}

/** Inline markdown → display characters (syntax hidden), each tied to `rawCol` in the same string `s`. */
function parseInlineCharMap(s: string, baseCol: number): MdDisplayChar[] {
  const out: MdDisplayChar[] = [];
  let i = 0;
  while (i < s.length) {
    const slice = s.slice(i);
    const code = slice.match(/^`([^`]*)`/);
    if (code !== null && code[0] !== undefined) {
      const inner = code[1] ?? '';
      const innerStart = baseCol + i + 1;
      pushPlainSliceAsChars(out, inner, innerStart, { dim: true });
      i += code[0].length;
      continue;
    }
    const bold = slice.match(/^\*\*([^*]+)\*\*/);
    if (bold !== null && bold[0] !== undefined) {
      const inner = bold[1] ?? '';
      const innerStart = baseCol + i + 2;
      pushPlainSliceAsChars(out, inner, innerStart, { bold: true });
      i += bold[0].length;
      continue;
    }
    const italic = slice.match(/^\*([^*]+)\*/);
    if (italic !== null && italic[0] !== undefined) {
      const inner = italic[1] ?? '';
      const innerStart = baseCol + i + 1;
      pushPlainSliceAsChars(out, inner, innerStart, { italic: true });
      i += italic[0].length;
      continue;
    }
    const next = slice.search(/[`*]/);
    if (next === -1) {
      pushPlainSliceAsChars(out, slice, baseCol + i, {});
      break;
    }
    if (next > 0) {
      pushPlainSliceAsChars(out, slice.slice(0, next), baseCol + i, {});
      i += next;
      continue;
    }
    out.push({ ch: slice[0] ?? ' ', style: {}, rawCol: baseCol + i });
    i += 1;
  }
  return out;
}

/**
 * Characters as shown by {@link MarkdownHintLine} / {@link parseMarkdownLineToRuns}, each mapped to
 * the buffer column in `line` that produced it (for selection hit-testing).
 */
export function markdownDisplayCharMap(line: string): MdDisplayChar[] {
  const normalized = line.replace(/\r/g, '').replace(/\t/g, ' ');
  if (normalized === '') {
    return [];
  }
  const heading = normalized.match(/^(#{1,6})(\s)(.*)$/);
  if (heading !== null) {
    const hashes = heading[1] ?? '';
    const sp = heading[2] ?? '';
    const rest = heading[3] ?? '';
    const out: MdDisplayChar[] = [];
    pushPlainSliceAsChars(out, hashes, 0, { dim: true });
    const spStart = hashes.length;
    pushPlainSliceAsChars(out, sp, spStart, { dim: true });
    const restStart = spStart + sp.length;
    out.push(...parseInlineCharMap(rest, restStart));
    return out;
  }
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(normalized)) {
    const out: MdDisplayChar[] = [];
    pushPlainSliceAsChars(out, normalized, 0, { dim: true });
    return out;
  }
  const bq = normalized.match(/^(\s*>\s?)(.*)$/);
  if (bq !== null) {
    const prefix = bq[1] ?? '';
    const rest = bq[2] ?? '';
    const out: MdDisplayChar[] = [];
    pushPlainSliceAsChars(out, prefix, 0, { dim: true });
    out.push(...parseInlineCharMap(rest, prefix.length));
    return out;
  }
  const li = normalized.match(/^(\s*(?:[-*+]|\d+\.)\s)(.*)$/);
  if (li !== null) {
    const prefix = li[1] ?? '';
    const rest = li[2] ?? '';
    const out: MdDisplayChar[] = [];
    pushPlainSliceAsChars(out, prefix, 0, { dim: true });
    out.push(...parseInlineCharMap(rest, prefix.length));
    return out;
  }
  return parseInlineCharMap(normalized, 0);
}

export function parseMarkdownLineToRuns(line: string): MdHintRun[] {
  const normalized = line.replace(/\r/g, '').replace(/\t/g, ' ');
  if (normalized === '') {
    return [{ text: '' }];
  }
  const heading = normalized.match(/^(#{1,6})(\s)(.*)$/);
  if (heading !== null) {
    const hashes = heading[1] ?? '';
    const sp = heading[2] ?? '';
    const rest = heading[3] ?? '';
    return mergeAdjacentRuns([{ text: `${hashes}${sp}`, dim: true }, ...parseInlineToRuns(rest)]);
  }
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(normalized)) {
    return [{ text: normalized, dim: true }];
  }
  const bq = normalized.match(/^(\s*>\s?)(.*)$/);
  if (bq !== null) {
    const prefix = bq[1] ?? '';
    const rest = bq[2] ?? '';
    return mergeAdjacentRuns([{ text: prefix, dim: true }, ...parseInlineToRuns(rest)]);
  }
  const li = normalized.match(/^(\s*(?:[-*+]|\d+\.)\s)(.*)$/);
  if (li !== null) {
    const prefix = li[1] ?? '';
    const rest = li[2] ?? '';
    return mergeAdjacentRuns([{ text: prefix, dim: true }, ...parseInlineToRuns(rest)]);
  }
  return parseInlineToRuns(normalized);
}

function appendToRow(row: MdHintRun[], text: string, style: MdHintStyle): void {
  if (text === '') {
    return;
  }
  const last = row[row.length - 1];
  if (last !== undefined && sameStyle(last, style)) {
    last.text += text;
  } else {
    row.push({ text, ...style });
  }
}

function rowPlainText(row: MdHintRun[]): string {
  return row.map((r) => r.text).join('');
}

function rowEndsWithSpace(row: MdHintRun[]): boolean {
  const t = rowPlainText(row);
  return t.length === 0 || /\s$/.test(t);
}

/** Word-wrap styled runs to the same widths as `wrapLineToRows` for a plain string. */
export function wrapRunsToRows(runs: MdHintRun[], width: number): MdHintRun[][] {
  if (width < 1) {
    return [runs];
  }
  const rows: MdHintRun[][] = [];
  let cur: MdHintRun[] = [];
  let rowLen = 0;

  const flush = () => {
    rows.push(cur);
    cur = [];
    rowLen = 0;
  };

  for (const run of runs) {
    const tokens = run.text.match(/\S+|\s+/g) ?? [run.text];
    for (const tok of tokens) {
      if (/^\s+$/.test(tok)) {
        if (rowLen + tok.length <= width) {
          appendToRow(cur, tok, run);
          rowLen += tok.length;
        } else if (cur.length > 0) {
          flush();
        }
        continue;
      }
      const word = tok;
      if (word.length > width) {
        if (cur.length > 0) {
          flush();
        }
        for (let j = 0; j < word.length; j += width) {
          const chunk = word.slice(j, j + width);
          appendToRow(cur, chunk, run);
          flush();
        }
        continue;
      }
      const needsGap = rowLen > 0 && !rowEndsWithSpace(cur);
      const gap = needsGap ? 1 : 0;
      if (rowLen + gap + word.length <= width) {
        if (gap > 0) {
          appendToRow(cur, ' ', run);
        }
        appendToRow(cur, word, run);
        rowLen += gap + word.length;
      } else {
        if (cur.length > 0) {
          flush();
        }
        appendToRow(cur, word, run);
        rowLen = word.length;
      }
    }
  }

  const tail = rowPlainText(cur).trimEnd();
  if (tail.length > 0 || rows.length === 0) {
    rows.push(cur);
  }
  return rows;
}

function padRunRow(runs: MdHintRun[], padTo: number): MdHintRun[] {
  const line = rowPlainText(runs);
  if (line.length >= padTo) {
    return runs;
  }
  const pad = ' '.repeat(padTo - line.length);
  if (runs.length === 0) {
    return [{ text: pad }];
  }
  const next = [...runs];
  const last = next[next.length - 1];
  if (last !== undefined && !last.dim && !last.bold && !last.italic) {
    last.text += pad;
  } else {
    next.push({ text: pad });
  }
  return next;
}

export function MarkdownHintLine({
  runs,
  padTo,
}: {
  runs: MdHintRun[];
  padTo: number;
}): ReactElement {
  const padded = padRunRow(runs, padTo);
  return (
    <Box flexDirection="row" width={padTo}>
      {padded.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: small stable run list per row
        <Text key={i} dimColor={r.dim} bold={r.bold} italic={r.italic} wrap="truncate-end">
          {r.text}
        </Text>
      ))}
    </Box>
  );
}

/**
 * One React row per wrapped display line — same row count as `linesToWrappedRows(lines, width)`.
 */
export function wrappedMarkdownHintRows(lines: string[], width: number): ReactElement[] {
  const out: ReactElement[] = [];
  let key = 0;
  for (const line of lines) {
    const runs = parseMarkdownLineToRuns(line);
    const rows = wrapRunsToRows(runs, width);
    for (const rowRuns of rows) {
      out.push(<MarkdownHintLine key={key} runs={rowRuns} padTo={width} />);
      key += 1;
    }
  }
  return out.length > 0 ? out : [<MarkdownHintLine key={0} runs={[{ text: '' }]} padTo={width} />];
}
