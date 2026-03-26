import { Box, Text } from 'ink';
import { type ReactNode, useMemo } from 'react';
import { linesToWrappedRows } from '../../utils/wrapTextRows.ts';

export interface ScrollViewProps {
  /** Logical lines (used with `wrapWidth`) or alone when not pre-wrapped. */
  lines?: string[];
  /**
   * Pre-built rows (e.g. styled markdown). Same length as wrapped `displayLines` for a given source; when set, string `displayLines` are not rendered.
   */
  rowElements?: ReactNode[];
  /**
   * Pre-wrapped display rows (skips `lines` / `wrapWidth`). Use with `TextViewport` for one wrap pass.
   */
  displayLines?: string[];
  /** Height in terminal rows (lines shown). */
  height: number;
  /** Zero-based row offset into logical `lines`, or into wrapped rows when `wrapWidth` is set. */
  scrollOffset?: number;
  /**
   * When set, each logical line is word-wrapped to this width; scrolling uses wrapped display rows.
   */
  wrapWidth?: number;
  /** Pad each row to this width (monospace) so the block reads as a column. */
  padToWidth?: number;
}

export function ScrollView({
  lines = [],
  rowElements,
  displayLines: displayLinesProp,
  height,
  scrollOffset = 0,
  wrapWidth,
  padToWidth,
}: ScrollViewProps) {
  const displayLines = useMemo(() => {
    if (displayLinesProp != null) {
      return displayLinesProp;
    }
    if (wrapWidth != null && wrapWidth > 0) {
      return linesToWrappedRows(lines, wrapWidth);
    }
    return lines;
  }, [displayLinesProp, lines, wrapWidth]);

  if (rowElements != null) {
    const end = Math.min(rowElements.length, scrollOffset + height);
    const slice = rowElements.slice(scrollOffset, end);
    const pad = padToWidth != null && padToWidth > 0 ? padToWidth : null;
    return (
      <Box
        flexDirection="column"
        flexGrow={pad == null ? 1 : undefined}
        width={pad ?? undefined}
        overflow={pad != null ? 'hidden' : undefined}
      >
        {slice.map((el, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: viewport slice offset
          <Box key={scrollOffset + i} width={pad ?? undefined}>
            {el}
          </Box>
        ))}
      </Box>
    );
  }

  const end = Math.min(displayLines.length, scrollOffset + height);
  const slice = displayLines.slice(scrollOffset, end);
  const pad = padToWidth != null && padToWidth > 0 ? padToWidth : null;
  const row = (line: string, i: number) => {
    const visual =
      pad == null ? line : line.length >= pad ? line.slice(0, pad) : line.padEnd(pad, ' ');
    return (
      <Box key={scrollOffset + i} width={pad ?? undefined}>
        <Text wrap="truncate-end">{visual}</Text>
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      flexGrow={pad == null ? 1 : undefined}
      width={pad ?? undefined}
      overflow={pad != null ? 'hidden' : undefined}
    >
      {slice.map((line, i) => row(line, i))}
    </Box>
  );
}
