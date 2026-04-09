/**
 * Split pasted / stored text into logical lines for wrapping.
 * CRLF and lone `\r` must not reach the terminal — `\r` resets the cursor to column 0 and
 * corrupts bordered layouts (borders appear to cut through words).
 */
export function splitLinesForWrap(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Word-wrap one logical line (no `\n`) to fixed display width.
 * Splits on words vs whitespace runs so spaces between words are preserved; long
 * tokens without spaces are hard-broken at `width`.
 */
export function wrapLineToRows(line: string, width: number): string[] {
  line = line.replace(/\r/g, '').replace(/\t/g, ' ');
  if (width < 1) {
    return [line];
  }
  if (line === '') {
    return [''];
  }

  const tokens = line.match(/\S+|\s+/g) ?? [line];
  const rows: string[] = [];
  let row = '';

  const flush = () => {
    const t = row.trimEnd();
    rows.push(t);
    row = '';
  };

  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (row.length + tok.length <= width) {
        row += tok;
      } else if (row.length > 0) {
        flush();
      }
      continue;
    }

    const word = tok;
    if (word.length > width) {
      if (row.length > 0) {
        flush();
      }
      for (let i = 0; i < word.length; i += width) {
        rows.push(word.slice(i, i + width));
      }
      row = '';
      continue;
    }

    const needsGap = row.length > 0 && !/\s$/.test(row);
    const gap = needsGap ? 1 : 0;
    if (row.length + gap + word.length <= width) {
      row += (needsGap ? ' ' : '') + word;
    } else {
      if (row.length > 0) {
        flush();
      }
      row = word;
    }
  }

  const tail = row.trimEnd();
  if (tail.length > 0 || rows.length === 0) {
    rows.push(tail);
  }
  return rows;
}

/** Each logical line becomes one or more wrapped display rows. */
export function linesToWrappedRows(lines: string[], width: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    out.push(...wrapLineToRows(line, width));
  }
  return out.length > 0 ? out : [''];
}

/** Max scroll offset when showing `viewportHeight` rows of wrapped content. */
export function wrappedScrollMax(
  lines: string[],
  viewportHeight: number,
  wrapWidth: number,
): number {
  const flat = linesToWrappedRows(lines, wrapWidth);
  return Math.max(0, flat.length - viewportHeight);
}
