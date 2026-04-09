/**
 * Character-offset cursor helpers for multiline logical buffers (newline-separated).
 */

export function lineColAtOffset(text: string, offset: number): { line: number; col: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  const head = text.slice(0, o);
  const line = head === '' ? 0 : (head.match(/\n/g)?.length ?? 0);
  const lastNl = head.lastIndexOf('\n');
  const col = lastNl === -1 ? o : o - lastNl - 1;
  return { line, col };
}

export function offsetAtLineCol(text: string, line: number, col: number): number {
  const lines = text.split('\n');
  const li = Math.max(0, Math.min(line, Math.max(0, lines.length - 1)));
  const row = lines[li] ?? '';
  const c = Math.max(0, Math.min(col, row.length));
  let off = 0;
  for (let i = 0; i < li; i++) {
    off += (lines[i]?.length ?? 0) + 1;
  }
  return off + c;
}

export function offsetLeft(_text: string, offset: number): number {
  return Math.max(0, offset - 1);
}

export function offsetRight(text: string, offset: number): number {
  return Math.min(text.length, offset + 1);
}

export function offsetUp(text: string, offset: number): number {
  const { line, col } = lineColAtOffset(text, offset);
  if (line <= 0) {
    return 0;
  }
  const lines = text.split('\n');
  const prevLen = lines[line - 1]?.length ?? 0;
  const nextCol = Math.min(col, prevLen);
  return offsetAtLineCol(text, line - 1, nextCol);
}

export function offsetDown(text: string, offset: number): number {
  const { line, col } = lineColAtOffset(text, offset);
  const lines = text.split('\n');
  if (line >= lines.length - 1) {
    return offset;
  }
  const nextLen = lines[line + 1]?.length ?? 0;
  const nextCol = Math.min(col, nextLen);
  return offsetAtLineCol(text, line + 1, nextCol);
}

export function insertAt(
  text: string,
  offset: number,
  ch: string,
): { next: string; cursor: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  const next = text.slice(0, o) + ch + text.slice(o);
  return { next, cursor: o + ch.length };
}

export function deleteBefore(text: string, offset: number): { next: string; cursor: number } {
  if (offset <= 0) {
    return { next: text, cursor: 0 };
  }
  const o = offset;
  return { next: text.slice(0, o - 1) + text.slice(o), cursor: o - 1 };
}

export function deleteAfter(text: string, offset: number): { next: string; cursor: number } {
  if (offset >= text.length) {
    return { next: text, cursor: offset };
  }
  return { next: text.slice(0, offset) + text.slice(offset + 1), cursor: offset };
}
