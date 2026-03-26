import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { offsetAtLineCol } from '../../textBufferCursor.ts';
import { layoutCursorBlockRow } from './freeCursorLayout.ts';

export function lineIntersectsSelection(
  text: string,
  globalLine: number,
  selection: { start: number; end: number } | null,
): boolean {
  if (selection == null || selection.start >= selection.end) {
    return false;
  }
  const lineStart = offsetAtLineCol(text, globalLine, 0);
  const lines = text.split('\n');
  const lineEndExclusive =
    globalLine + 1 < lines.length ? offsetAtLineCol(text, globalLine + 1, 0) : text.length;
  return selection.start < lineEndExclusive && selection.end > lineStart;
}

function colSelected(
  text: string,
  globalLine: number,
  lineRaw: string,
  visualCol: number,
  selection: { start: number; end: number },
): boolean {
  if (visualCol >= lineRaw.length) {
    return false;
  }
  const g = offsetAtLineCol(text, globalLine, visualCol);
  return g >= selection.start && g < selection.end;
}

/** One terminal cell per buffer character; selection merged into Text runs. */
function segmentedPlainRow(
  padded: string,
  text: string,
  globalLine: number,
  lineRaw: string,
  textCols: number,
  selection: { start: number; end: number },
  noColor: boolean,
): ReactElement {
  const runs: { t: string; sel: boolean }[] = [];
  for (let c = 0; c < textCols; c++) {
    const ch = padded[c] ?? ' ';
    const sel = colSelected(text, globalLine, lineRaw, c, selection);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.sel === sel) {
      last.t += ch;
    } else {
      runs.push({ t: ch, sel });
    }
  }
  return (
    <Box flexDirection="row" width={textCols}>
      {runs.map((r, i) =>
        r.sel ? (
          noColor ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
            <Text key={i} bold wrap="truncate-end">
              {r.t}
            </Text>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
            <Text key={i} backgroundColor="blue" color="white" wrap="truncate-end">
              {r.t}
            </Text>
          )
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
          <Text key={i} wrap="truncate-end">
            {r.t}
          </Text>
        ),
      )}
    </Box>
  );
}

/**
 * Plain display row: exactly matches the padded buffer slice (one cell per character).
 * Read-only resume uses {@link wrappedMarkdownHintRows} for hint styling; the editor must stay
 * plain so mouse, caret, and selection offsets stay aligned.
 */
export function FreeCursorPlainRow({
  padded,
  text,
  globalLine,
  lineRaw,
  textCols,
  selection,
  noColor,
}: {
  padded: string;
  text: string;
  globalLine: number;
  lineRaw: string;
  textCols: number;
  selection: { start: number; end: number } | null;
  noColor: boolean;
}): ReactElement {
  if (
    selection != null &&
    selection.start < selection.end &&
    lineIntersectsSelection(text, globalLine, selection)
  ) {
    return segmentedPlainRow(padded, text, globalLine, lineRaw, textCols, selection, noColor);
  }
  return (
    <Box flexDirection="row" width={textCols}>
      <Text wrap="truncate-end">{padded}</Text>
    </Box>
  );
}

/** Caret line: selection backgrounds on left/right; mid cell uses inverse/bold caret styling. */
export function FreeCursorCaretRow({
  text,
  globalLine,
  lineRaw,
  padded,
  cc,
  textCols,
  selection,
  noColor,
}: {
  text: string;
  globalLine: number;
  lineRaw: string;
  padded: string;
  cc: number;
  textCols: number;
  selection: { start: number; end: number } | null;
  noColor: boolean;
}): ReactElement {
  const blk = layoutCursorBlockRow(padded, cc, textCols);

  const renderSide = (slice: string, startCol: number): ReactElement => {
    if (slice === '') {
      return <Box width={0} />;
    }
    const runs: { t: string; sel: boolean }[] = [];
    for (let i = 0; i < slice.length; i++) {
      const visualCol = startCol + i;
      const sel =
        selection != null &&
        selection.start < selection.end &&
        colSelected(text, globalLine, lineRaw, visualCol, selection);
      const ch = slice[i] ?? ' ';
      const last = runs[runs.length - 1];
      if (last !== undefined && last.sel === sel) {
        last.t += ch;
      } else {
        runs.push({ t: ch, sel });
      }
    }
    return (
      <Box flexDirection="row" width={slice.length}>
        {runs.map((r, i) =>
          r.sel ? (
            noColor ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
              <Text key={i} bold>
                {r.t}
              </Text>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
              <Text key={i} backgroundColor="blue" color="white">
                {r.t}
              </Text>
            )
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable run list
            <Text key={i} wrap="truncate-end">
              {r.t}
            </Text>
          ),
        )}
      </Box>
    );
  };

  const mid = (
    <Box width={1}>
      {noColor ? <Text bold>{blk.charUnder}</Text> : <Text inverse>{blk.charUnder}</Text>}
    </Box>
  );

  return (
    <Box flexDirection="row" width={textCols}>
      {blk.leftW > 0 ? renderSide(blk.left, 0) : null}
      {mid}
      {blk.rightW > 0 ? renderSide(blk.right, cc + 1) : null}
    </Box>
  );
}
