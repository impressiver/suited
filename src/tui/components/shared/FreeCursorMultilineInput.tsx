import { Box, type DOMElement, Text, useInput, useStdin } from 'ink';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shouldUseNoColor } from '../../env.ts';
import { useDebouncedStringCallback } from '../../hooks/useDebouncedStringCallback.ts';
import { terminalChunkIsBackspaceAs127 } from '../../stdinBackspaceAsDelete127.ts';
import { useAppDispatch } from '../../store.tsx';
import {
  deleteAfter,
  deleteBefore,
  insertAt,
  lineColAtOffset,
  offsetAtLineCol,
  offsetDown,
  offsetLeft,
  offsetRight,
  offsetUp,
} from '../../textBufferCursor.ts';
import {
  bufferOffsetInEditorViewport,
  getDomElementScreenRect,
} from '../../utils/editorViewportLayout.ts';
import { parseSgrMouseEvent } from '../../utils/sgrMouseWheel.ts';
import { FreeCursorCaretRow, FreeCursorPlainRow } from './freeCursorLineSegments.tsx';
import { MarkdownEditorScrollGutter } from './MarkdownEditorScrollGutter.tsx';
import { TextViewport } from './TextViewport.tsx';

// ---------------------------------------------------------------------------
// Word-wrap map: maps display rows → logical line positions
// ---------------------------------------------------------------------------

export interface WrapRow {
  logLine: number;
  colStart: number;
  text: string;
}

export function buildWrapMap(logicalLines: string[], width: number): WrapRow[] {
  const rows: WrapRow[] = [];
  for (let li = 0; li < logicalLines.length; li++) {
    const line = logicalLines[li]!;
    if (line.length <= width || width < 1) {
      rows.push({ logLine: li, colStart: 0, text: line });
      continue;
    }
    let pos = 0;
    while (pos < line.length) {
      const remaining = line.length - pos;
      if (remaining <= width) {
        rows.push({ logLine: li, colStart: pos, text: line.slice(pos) });
        break;
      }
      let breakPos = pos + width;
      for (let j = breakPos - 1; j > pos; j--) {
        if (line[j] === ' ') {
          breakPos = j + 1;
          break;
        }
      }
      rows.push({ logLine: li, colStart: pos, text: line.slice(pos, breakPos) });
      pos = breakPos;
    }
  }
  if (rows.length === 0) {
    rows.push({ logLine: 0, colStart: 0, text: '' });
  }
  return rows;
}

export function findCursorWrapRow(
  wrapMap: WrapRow[],
  logLine: number,
  col: number,
): { wrapIdx: number; visualCol: number } {
  for (let i = 0; i < wrapMap.length; i++) {
    const row = wrapMap[i]!;
    if (row.logLine !== logLine) continue;
    const isLastOfLine = i + 1 >= wrapMap.length || wrapMap[i + 1]!.logLine !== logLine;
    const colEnd = row.colStart + row.text.length;
    if (col >= row.colStart && (col < colEnd || isLastOfLine)) {
      return { wrapIdx: i, visualCol: col - row.colStart };
    }
  }
  const last = wrapMap.length - 1;
  return { wrapIdx: last, visualCol: Math.max(0, col - (wrapMap[last]?.colStart ?? 0)) };
}

function wrapOffsetUp(text: string, offset: number, wrapMap: WrapRow[]): number {
  const { line, col } = lineColAtOffset(text, offset);
  const { wrapIdx, visualCol } = findCursorWrapRow(wrapMap, line, col);
  if (wrapIdx <= 0) return 0;
  const prev = wrapMap[wrapIdx - 1]!;
  const newCol = prev.colStart + Math.min(visualCol, prev.text.length);
  return offsetAtLineCol(text, prev.logLine, newCol);
}

function wrapOffsetDown(text: string, offset: number, wrapMap: WrapRow[]): number {
  const { line, col } = lineColAtOffset(text, offset);
  const { wrapIdx, visualCol } = findCursorWrapRow(wrapMap, line, col);
  if (wrapIdx >= wrapMap.length - 1) return offset;
  const next = wrapMap[wrapIdx + 1]!;
  const newCol = next.colStart + Math.min(visualCol, next.text.length);
  return offsetAtLineCol(text, next.logLine, newCol);
}

const DEBOUNCE_MS = 16;

export interface JumpToCharRequest {
  /** Bumps when the parent wants the same offset applied again. */
  nonce: number;
  offset: number;
}

export interface FreeCursorMultilineInputProps {
  value: string;
  /**
   * Increment when `value` is replaced from outside the field (load, save normalize, polish accept).
   * Omit or keep stable while the user types so debounced `onChange` → parent `value` does not
   * stomp local edits or clear terminal selection.
   */
  /** When omitted, every `value` change replaces the buffer (can fight debounced parents). */
  externalContentRevision?: number;
  onChange: (value: string) => void;
  focus: boolean;
  /** Total columns inside the frame; when wider than one column, one is reserved for the scroll gutter. */
  width: number;
  height: number;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onCaretOffsetChange?: (offset: number) => void;
  /** Move caret (e.g. outline jump); consumed via `onConsumedJumpToChar`. */
  jumpToChar?: JumpToCharRequest | null;
  onConsumedJumpToChar?: () => void;
  /**
   * When dashboard chrome above the editor changes height, pass a new value so Yoga layout
   * for mouse hit-testing is refreshed.
   */
  geometryTie?: string | number;
  /** Word-wrap long lines instead of truncating. */
  wordWrap?: boolean;
}

/**
 * Logical-line multiline editor (one terminal row per logical line, truncated to the text width).
 * When `width` is greater than 1, the rightmost column is a scroll thumb; editable text uses `width - 1` columns.
 * Arrow keys move the caret; viewport scrolls vertically to keep the caret line visible.
 */
export function FreeCursorMultilineInput({
  value,
  externalContentRevision,
  onChange,
  focus,
  width,
  height,
  placeholder,
  onSubmit,
  onCaretOffsetChange,
  jumpToChar,
  onConsumedJumpToChar,
  geometryTie,
  wordWrap,
}: FreeCursorMultilineInputProps) {
  const scrollGutterCols = width > 1 ? 1 : 0;
  const textCols = Math.max(1, width - scrollGutterCols);
  const framedInnerW = textCols + scrollGutterCols;

  const dispatch = useAppDispatch();
  const { stdin } = useStdin();
  const backwardDelete127Ref = useRef(false);
  const bufferRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [scrollLine, setScrollLine] = useState(0);
  const lastExternalRevisionRef = useRef<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const dragAnchorRef = useRef<number | null>(null);
  const scrollbarDragRef = useRef<{
    dragging: boolean;
    startY: number;
    startScroll: number;
  } | null>(null);
  /** First visible logical line's `Box` — matches Ink's drawn row (avoids wrapper/border offset drift). */
  const editorHitOriginRef = useRef<DOMElement | null>(null);
  const frameGeomRef = useRef<ReturnType<typeof getDomElementScreenRect>>(null);

  const { schedule: scheduleFlush, cancel: cancelDebouncedFlush } = useDebouncedStringCallback(
    onChange,
    DEBOUNCE_MS,
  );

  const notifyCaret = useCallback(
    (off: number) => {
      onCaretOffsetChange?.(off);
    },
    [onCaretOffsetChange],
  );

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (externalContentRevision === undefined) {
      bufferRef.current = value;
      setDisplayValue(value);
      setCursorOffset((c) => Math.min(c, value.length));
      setSelection(null);
      return;
    }
    if (lastExternalRevisionRef.current === null) {
      lastExternalRevisionRef.current = externalContentRevision;
      bufferRef.current = value;
      return;
    }
    if (externalContentRevision === lastExternalRevisionRef.current) {
      return;
    }
    lastExternalRevisionRef.current = externalContentRevision;
    bufferRef.current = value;
    setDisplayValue(value);
    setCursorOffset((c) => Math.min(c, value.length));
    setSelection(null);
  }, [value, externalContentRevision]);

  useEffect(() => {
    if (jumpToChar == null) {
      return;
    }
    const len = bufferRef.current.length;
    const c = Math.max(0, Math.min(jumpToChar.offset, len));
    setCursorOffset(c);
    setSelection(null);
    notifyCaret(c);
    onConsumedJumpToChar?.();
  }, [jumpToChar, notifyCaret, onConsumedJumpToChar]);

  useEffect(() => {
    dispatch({ type: 'SET_IN_TEXT_INPUT', value: focus });
    return () => {
      dispatch({ type: 'SET_IN_TEXT_INPUT', value: false });
    };
  }, [focus, dispatch]);

  useEffect(() => {
    if (!focus || stdin == null) {
      return;
    }
    const onData = (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
      if (terminalChunkIsBackspaceAs127(buf)) {
        backwardDelete127Ref.current = true;
      }
    };
    stdin.prependListener('data', onData);
    return () => {
      stdin.removeListener('data', onData);
    };
  }, [focus, stdin]);

  const logicalLines = useMemo(() => {
    if (displayValue.length === 0) {
      return [''];
    }
    return displayValue.split('\n');
  }, [displayValue]);

  const wrapMap = useMemo(
    () => (wordWrap ? buildWrapMap(logicalLines, textCols) : null),
    [wordWrap, logicalLines, textCols],
  );
  const wrapMapRef = useRef(wrapMap);
  wrapMapRef.current = wrapMap;

  const totalDisplayRows = wrapMap ? wrapMap.length : logicalLines.length;

  const padLine = (s: string) =>
    s.length >= textCols ? s.slice(0, textCols) : s.padEnd(textCols, ' ');

  const applyBuffer = useCallback(
    (next: string, nextCursor: number) => {
      bufferRef.current = next;
      setDisplayValue(next);
      const c = Math.max(0, Math.min(nextCursor, next.length));
      setCursorOffset(c);
      notifyCaret(c);
      scheduleFlush(next);
    },
    [notifyCaret, scheduleFlush],
  );

  /** Keep the caret line inside [scrollLine, scrollLine + height) before Ink paints (avoids “missing” caret). */
  useLayoutEffect(() => {
    const wm = wrapMapRef.current;
    const lines = displayValue.length === 0 ? ([''] as string[]) : displayValue.split('\n');
    const rowCount = wm ? wm.length : lines.length;
    const maxSl = Math.max(0, rowCount - height);
    const { line: caretLogLine, col: caretCol } = lineColAtOffset(displayValue, cursorOffset);
    const caretRow = wm
      ? findCursorWrapRow(wm, caretLogLine, caretCol).wrapIdx
      : caretLogLine;
    setScrollLine((sl) => {
      const slClamped = Math.min(Math.max(0, sl), maxSl);
      if (caretRow < slClamped) {
        return caretRow;
      }
      if (caretRow >= slClamped + height) {
        return caretRow - height + 1;
      }
      return slClamped;
    });
  }, [cursorOffset, displayValue, height]);

  const maxScrollLine = Math.max(0, totalDisplayRows - height);
  const scrollClamped = Math.min(scrollLine, maxScrollLine);

  // Remeasure after layout: origin is the first *drawn* editor row (matches Ink output).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional remeasure triggers
  useLayoutEffect(() => {
    frameGeomRef.current = getDomElementScreenRect(editorHitOriginRef.current);
  }, [geometryTie, width, height, scrollClamped, displayValue]);

  const scrollClampedRef = useRef(scrollClamped);
  const maxScrollLineRef = useRef(maxScrollLine);
  scrollClampedRef.current = scrollClamped;
  maxScrollLineRef.current = maxScrollLine;

  useInput(
    (input, key) => {
      if (!focus) {
        return;
      }

      const mouse = parseSgrMouseEvent(input);
      if (mouse != null) {
        if (mouse.kind === 'wheel') {
          const cap = maxScrollLineRef.current;
          setScrollLine((s) => Math.max(0, Math.min(cap, s + mouse.delta)));
          return;
        }
        if (mouse.kind === 'pointer') {
          const g = frameGeomRef.current;
          if (mouse.released) {
            dragAnchorRef.current = null;
            scrollbarDragRef.current = null;
            return;
          }
          if (g != null) {
            // Check if the click is on the scrollbar column (rightmost column of the text area)
            const relativeX = mouse.px - g.left;
            const relativeY = mouse.py - g.top;

            // Scrollbar is at column textCols (0-indexed), so check if click is there
            const isOnScrollbar = scrollGutterCols > 0 && relativeX === textCols;

            if (isOnScrollbar && maxScrollLineRef.current > 0) {
              // Handle scrollbar drag
              if (mouse.leftPress) {
                // Start scrollbar drag
                scrollbarDragRef.current = {
                  dragging: true,
                  startY: relativeY,
                  startScroll: scrollClampedRef.current,
                };
                // Also jump to the clicked position proportionally
                const clickedRatio = relativeY / height;
                const targetScroll = Math.round(clickedRatio * maxScrollLineRef.current);
                setScrollLine(Math.max(0, Math.min(maxScrollLineRef.current, targetScroll)));
                return;
              }
              if (mouse.leftDrag && scrollbarDragRef.current?.dragging) {
                // Continue scrollbar drag - move proportionally
                const dragDelta = relativeY - scrollbarDragRef.current.startY;
                const scrollDelta = Math.round((dragDelta / height) * maxScrollLineRef.current);
                const targetScroll = scrollbarDragRef.current.startScroll + scrollDelta;
                setScrollLine(Math.max(0, Math.min(maxScrollLineRef.current, targetScroll)));
                return;
              }
              return;
            }

            // Not on scrollbar - handle as text selection
            const off = bufferOffsetInEditorViewport(
              mouse.px,
              mouse.py,
              g,
              textCols,
              height,
              scrollClampedRef.current,
              bufferRef.current,
            );
            if (off != null) {
              if (mouse.leftPress) {
                dragAnchorRef.current = off;
                setSelection(null);
                setCursorOffset(off);
                notifyCaret(off);
                return;
              }
              if (mouse.leftDrag) {
                const a = dragAnchorRef.current;
                if (a != null) {
                  const lo = Math.min(a, off);
                  const hi = Math.max(a, off);
                  if (lo < hi) {
                    setSelection({ start: lo, end: hi });
                  } else {
                    setSelection(null);
                  }
                  setCursorOffset(off);
                  notifyCaret(off);
                }
                return;
              }
            }
          }
          return;
        }
        return;
      }

      if (
        key.ctrl &&
        !key.meta &&
        input != null &&
        (input.toLowerCase() === 'd' || input.toLowerCase() === 's')
      ) {
        cancelDebouncedFlush();
        setSelection(null);
        onChange(bufferRef.current);
        onSubmit?.(bufferRef.current);
        return;
      }

      if (key.escape) {
        return;
      }

      const buf = bufferRef.current;
      let cur = cursorOffset;
      const clearSel = () => {
        setSelection(null);
      };

      if (key.leftArrow) {
        clearSel();
        cur = offsetLeft(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.rightArrow) {
        clearSel();
        cur = offsetRight(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.upArrow) {
        clearSel();
        const wm = wrapMapRef.current;
        cur = wm ? wrapOffsetUp(buf, cur, wm) : offsetUp(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.downArrow) {
        clearSel();
        const wm = wrapMapRef.current;
        cur = wm ? wrapOffsetDown(buf, cur, wm) : offsetDown(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }

      if (key.pageUp) {
        clearSel();
        setScrollLine((s) => Math.max(0, s - Math.max(1, height - 1)));
        return;
      }
      if (key.pageDown) {
        clearSel();
        const cap = maxScrollLineRef.current;
        setScrollLine((s) => Math.min(cap, s + Math.max(1, height - 1)));
        return;
      }

      const applyRangeDelete = (): { base: string; at: number } => {
        const sel = selectionRef.current;
        if (sel != null && sel.start < sel.end) {
          const base = buf.slice(0, sel.start) + buf.slice(sel.end);
          const at = sel.start;
          setSelection(null);
          return { base, at };
        }
        return { base: buf, at: cur };
      };

      if (key.return) {
        const { base, at } = applyRangeDelete();
        const ins = insertAt(base, at, '\n');
        applyBuffer(ins.next, ins.cursor);
        return;
      }

      if (key.backspace || key.delete) {
        const sel = selectionRef.current;
        if (sel != null && sel.start < sel.end) {
          const next = buf.slice(0, sel.start) + buf.slice(sel.end);
          applyBuffer(next, sel.start);
          setSelection(null);
          return;
        }
        const backward = key.backspace || backwardDelete127Ref.current;
        backwardDelete127Ref.current = false;
        const out = backward ? deleteBefore(buf, cur) : deleteAfter(buf, cur);
        applyBuffer(out.next, out.cursor);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        const { base, at } = applyRangeDelete();
        const ins = insertAt(base, at, input);
        applyBuffer(ins.next, ins.cursor);
      }
    },
    { isActive: focus },
  );

  const { line: curLogLine, col: curLogCol } = lineColAtOffset(displayValue, cursorOffset);
  const noColor = shouldUseNoColor();

  // Compute display rows: either wrapped or 1:1 logical lines
  const cursorDisplay = wrapMap
    ? findCursorWrapRow(wrapMap, curLogLine, curLogCol)
    : { wrapIdx: curLogLine, visualCol: curLogCol };

  const displayRows: { lineRaw: string; logLine: number; colOffset: number; rowIdx: number }[] = [];
  if (wrapMap) {
    const slice = wrapMap.slice(scrollClamped, scrollClamped + height);
    for (let i = 0; i < slice.length; i++) {
      const wr = slice[i]!;
      displayRows.push({ lineRaw: wr.text, logLine: wr.logLine, colOffset: wr.colStart, rowIdx: scrollClamped + i });
    }
  } else {
    const slice = logicalLines.slice(scrollClamped, scrollClamped + height);
    for (let i = 0; i < slice.length; i++) {
      displayRows.push({ lineRaw: slice[i]!, logLine: scrollClamped + i, colOffset: 0, rowIdx: scrollClamped + i });
    }
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <TextViewport
        panelWidth={framedInnerW + 2}
        viewportHeight={height}
        scrollOffset={scrollClamped}
        totalRows={totalDisplayRows}
        kind="Resume (markdown)"
      >
        <Box flexDirection="row" width={framedInnerW}>
          <Box flexDirection="column" width={textCols}>
            {displayRows.map((dr, i) => {
              const isCursorRow = focus && dr.rowIdx === cursorDisplay.wrapIdx;
              const showPlaceholder =
                displayValue === '' && dr.rowIdx === 0 && i === 0 && Boolean(placeholder);
              const padded = showPlaceholder
                ? (placeholder ?? '').slice(0, textCols).padEnd(textCols, ' ')
                : padLine(dr.lineRaw);
              const cc = isCursorRow ? Math.min(cursorDisplay.visualCol, textCols) : 0;
              return (
                <Box
                  key={`ln-${dr.rowIdx}`}
                  ref={i === 0 ? editorHitOriginRef : undefined}
                  flexDirection="row"
                  width={textCols}
                >
                  {showPlaceholder ? (
                    <Text dimColor wrap="truncate-end">
                      {padded}
                    </Text>
                  ) : isCursorRow ? (
                    <FreeCursorCaretRow
                      text={displayValue}
                      globalLine={dr.logLine}
                      lineRaw={dr.lineRaw}
                      padded={padded}
                      cc={cc}
                      textCols={textCols}
                      selection={selection}
                      noColor={noColor}
                      colOffset={dr.colOffset}
                    />
                  ) : (
                    <FreeCursorPlainRow
                      padded={padded}
                      text={displayValue}
                      globalLine={dr.logLine}
                      lineRaw={dr.lineRaw}
                      textCols={textCols}
                      selection={selection}
                      noColor={noColor}
                      colOffset={dr.colOffset}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
          {/* Scrollbar gutter - always render but may be empty when no scroll needed */}
          <Box width={scrollGutterCols}>
            {scrollGutterCols > 0 && (
              <MarkdownEditorScrollGutter
                viewportHeight={height}
                scrollOffset={scrollClamped}
                totalLines={totalDisplayRows}
              />
            )}
          </Box>
        </Box>
      </TextViewport>
    </Box>
  );
}
