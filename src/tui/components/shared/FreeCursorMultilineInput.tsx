import { Box, Text, useInput, useStdin } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldUseNoColor } from '../../env.ts';
import { useDebouncedStringCallback } from '../../hooks/useDebouncedStringCallback.ts';
import { terminalChunkIsBackspaceAs127 } from '../../stdinBackspaceAsDelete127.ts';
import { useAppDispatch } from '../../store.tsx';
import {
  deleteAfter,
  deleteBefore,
  insertAt,
  lineColAtOffset,
  offsetDown,
  offsetLeft,
  offsetRight,
  offsetUp,
} from '../../textBufferCursor.ts';
import { layoutCursorBlockRow } from './freeCursorLayout.ts';
import { TextViewport } from './TextViewport.tsx';

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
  width: number;
  height: number;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onCaretOffsetChange?: (offset: number) => void;
  /** Move caret (e.g. outline jump); consumed via `onConsumedJumpToChar`. */
  jumpToChar?: JumpToCharRequest | null;
  onConsumedJumpToChar?: () => void;
}

/**
 * Logical-line multiline editor (one terminal row per logical line, truncated to `width`).
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
}: FreeCursorMultilineInputProps) {
  const dispatch = useAppDispatch();
  const { stdin } = useStdin();
  const backwardDelete127Ref = useRef(false);
  const bufferRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [scrollLine, setScrollLine] = useState(0);
  const lastExternalRevisionRef = useRef<number | null>(null);

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
    if (externalContentRevision === undefined) {
      bufferRef.current = value;
      setDisplayValue(value);
      setCursorOffset((c) => Math.min(c, value.length));
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
  }, [value, externalContentRevision]);

  useEffect(() => {
    if (jumpToChar == null) {
      return;
    }
    const len = bufferRef.current.length;
    const c = Math.max(0, Math.min(jumpToChar.offset, len));
    setCursorOffset(c);
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

  const padLine = (s: string) => (s.length >= width ? s.slice(0, width) : s.padEnd(width, ' '));

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

  useEffect(() => {
    const { line } = lineColAtOffset(displayValue, cursorOffset);
    setScrollLine((sl) => {
      if (line < sl) {
        return line;
      }
      if (line >= sl + height) {
        return line - height + 1;
      }
      return sl;
    });
  }, [cursorOffset, displayValue, height]);

  const maxScrollLine = Math.max(0, logicalLines.length - height);
  const scrollClamped = Math.min(scrollLine, maxScrollLine);

  useInput(
    (input, key) => {
      if (!focus) {
        return;
      }

      if (
        key.ctrl &&
        !key.meta &&
        input != null &&
        (input.toLowerCase() === 'd' || input.toLowerCase() === 's')
      ) {
        cancelDebouncedFlush();
        onChange(bufferRef.current);
        onSubmit?.(bufferRef.current);
        return;
      }

      if (key.escape) {
        return;
      }

      const buf = bufferRef.current;
      let cur = cursorOffset;

      if (key.leftArrow) {
        cur = offsetLeft(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.rightArrow) {
        cur = offsetRight(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.upArrow) {
        cur = offsetUp(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }
      if (key.downArrow) {
        cur = offsetDown(buf, cur);
        setCursorOffset(cur);
        notifyCaret(cur);
        return;
      }

      if (key.pageUp) {
        setScrollLine((s) => Math.max(0, s - Math.max(1, height - 1)));
        return;
      }
      if (key.pageDown) {
        setScrollLine((s) => Math.min(maxScrollLine, s + Math.max(1, height - 1)));
        return;
      }

      if (key.return) {
        const ins = insertAt(buf, cur, '\n');
        applyBuffer(ins.next, ins.cursor);
        return;
      }

      if (key.backspace || key.delete) {
        const backward = key.backspace || backwardDelete127Ref.current;
        backwardDelete127Ref.current = false;
        const out = backward ? deleteBefore(buf, cur) : deleteAfter(buf, cur);
        applyBuffer(out.next, out.cursor);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        const ins = insertAt(buf, cur, input);
        applyBuffer(ins.next, ins.cursor);
      }
    },
    { isActive: focus },
  );

  const sliceLines = logicalLines.slice(scrollClamped, scrollClamped + height);
  const { line: curLine, col: curCol } = lineColAtOffset(displayValue, cursorOffset);
  const noColor = shouldUseNoColor();

  return (
    <Box flexDirection="column" flexGrow={1}>
      <TextViewport
        panelWidth={width + 2}
        viewportHeight={height}
        scrollOffset={scrollClamped}
        totalRows={logicalLines.length}
        kind="Resume (markdown)"
      >
        <Box flexDirection="column" width={width}>
          {sliceLines.map((lineRaw, i) => {
            const globalLine = scrollClamped + i;
            const isCursorLine = focus && globalLine === curLine;
            const showPlaceholder =
              displayValue === '' && globalLine === 0 && i === 0 && Boolean(placeholder);
            const padded = showPlaceholder
              ? (placeholder ?? '').slice(0, width).padEnd(width, ' ')
              : padLine(lineRaw);
            const cc = isCursorLine ? Math.min(curCol, width) : 0;
            const blk = layoutCursorBlockRow(padded, cc, width);
            const midBlank =
              blk.charUnder === ' ' || blk.charUnder === '' || blk.charUnder === '\t';
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: viewport slice
              <Box key={`${scrollClamped}-${i}`} flexDirection="row" width={width}>
                {showPlaceholder ? (
                  <Text dimColor wrap="truncate-end">
                    {padded}
                  </Text>
                ) : isCursorLine ? (
                  <Box flexDirection="row" width={width}>
                    {blk.leftW > 0 ? (
                      <Box width={blk.leftW}>
                        <Text wrap="truncate-end">{blk.left}</Text>
                      </Box>
                    ) : null}
                    <Box width={1}>
                      {midBlank ? (
                        noColor ? (
                          <Text bold>▌</Text>
                        ) : (
                          <Text bold color="cyan">
                            ▌
                          </Text>
                        )
                      ) : noColor ? (
                        <Text bold>{blk.charUnder}</Text>
                      ) : (
                        <Text inverse>{blk.charUnder}</Text>
                      )}
                    </Box>
                    {blk.rightW > 0 ? (
                      <Box width={blk.rightW}>
                        <Text wrap="truncate-end">{blk.right}</Text>
                      </Box>
                    ) : null}
                  </Box>
                ) : (
                  <Text wrap="truncate-end">{padded}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      </TextViewport>
    </Box>
  );
}
