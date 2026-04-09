import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedStringCallback } from '../../hooks/useDebouncedStringCallback.ts';
import { useAppDispatch } from '../../store.tsx';
import { linesToWrappedRows, splitLinesForWrap } from '../../utils/wrapTextRows.ts';
import { TextViewport } from './TextViewport.tsx';

const DEBOUNCE_MS = 16;
const CURSOR_BLINK_MS = 530;

export interface MultilineInputProps {
  value: string;
  onChange: (value: string) => void;
  /** When true, captures keys (and sets text-input gate). */
  focus: boolean;
  placeholder?: string;
  /** Called on Ctrl+D or Ctrl+S (save / done). */
  onSubmit?: (value: string) => void;
  /** Shown from debounced value (not per-keystroke live count). */
  showCharCount?: boolean;
  /**
   * When set, wraps each line within this width so pasted text stays in the panel.
   */
  width?: number;
  /**
   * When set with `width`, only this many rows are rendered; content scrolls (tail-follow while typing;
   * PgUp/PgDn and ↑↓ scroll manually).
   */
  height?: number;
}

/**
 * Multiline field with ref-buffered input and debounced `onChange` (paste-friendly).
 * Ctrl+D or Ctrl+S submits; Enter inserts newline; Esc is left to parent / global handler.
 */
export function MultilineInput({
  value,
  onChange,
  focus,
  placeholder,
  onSubmit,
  showCharCount,
  width,
  height,
}: MultilineInputProps) {
  const dispatch = useAppDispatch();
  const bufferRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [cursorOn, setCursorOn] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const manualScrollRef = useRef(false);

  const viewportMode = height != null && width != null && height > 0 && width > 0;

  const { schedule: scheduleFlush, cancel: cancelDebouncedFlush } = useDebouncedStringCallback(
    onChange,
    DEBOUNCE_MS,
  );

  const submitNow = useCallback(() => {
    const v = bufferRef.current;
    cancelDebouncedFlush();
    onChange(v);
    onSubmit?.(v);
  }, [cancelDebouncedFlush, onChange, onSubmit]);

  useEffect(() => {
    bufferRef.current = value;
    setDisplayValue(value);
  }, [value]);

  useEffect(() => {
    dispatch({ type: 'SET_IN_TEXT_INPUT', value: focus });
    return () => {
      dispatch({ type: 'SET_IN_TEXT_INPUT', value: false });
    };
  }, [focus, dispatch]);

  useEffect(() => {
    if (!focus) {
      setCursorOn(true);
      return;
    }
    const id = setInterval(() => setCursorOn((c) => !c), CURSOR_BLINK_MS);
    return () => clearInterval(id);
  }, [focus]);

  const displayRows = useMemo(() => {
    if (!viewportMode) {
      return [];
    }
    return linesToWrappedRows(splitLinesForWrap(displayValue), width);
  }, [displayValue, viewportMode, width]);

  useEffect(() => {
    if (!viewportMode || height == null) {
      return;
    }
    const maxScroll = Math.max(0, displayRows.length - height);
    setScrollOffset((s) => {
      if (manualScrollRef.current) {
        return Math.min(s, maxScroll);
      }
      return maxScroll;
    });
  }, [displayRows.length, height, viewportMode]);

  const getWrappedRows = useCallback(() => {
    if (!viewportMode || width == null) {
      return [];
    }
    return linesToWrappedRows(splitLinesForWrap(bufferRef.current), width);
  }, [viewportMode, width]);

  useInput(
    (input, key) => {
      if (!focus) return;

      if (
        key.ctrl &&
        !key.meta &&
        input != null &&
        (input.toLowerCase() === 'd' || input.toLowerCase() === 's')
      ) {
        submitNow();
        return;
      }

      if (viewportMode && height != null) {
        if (key.pageUp) {
          manualScrollRef.current = true;
          const step = Math.max(1, height - 1);
          setScrollOffset((s) => Math.max(0, s - step));
          return;
        }
        if (key.pageDown) {
          manualScrollRef.current = true;
          const rows = getWrappedRows();
          const maxScroll = Math.max(0, rows.length - height);
          const step = Math.max(1, height - 1);
          setScrollOffset((s) => Math.min(maxScroll, s + step));
          return;
        }
        if (key.upArrow) {
          manualScrollRef.current = true;
          setScrollOffset((s) => Math.max(0, s - 1));
          return;
        }
        if (key.downArrow) {
          manualScrollRef.current = true;
          const rows = getWrappedRows();
          const maxScroll = Math.max(0, rows.length - height);
          setScrollOffset((s) => Math.min(maxScroll, s + 1));
          return;
        }
      }

      if (key.return) {
        manualScrollRef.current = false;
        bufferRef.current += '\n';
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
        return;
      }

      if (key.backspace || key.delete) {
        manualScrollRef.current = false;
        bufferRef.current = bufferRef.current.slice(0, -1);
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        manualScrollRef.current = false;
        bufferRef.current += input;
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
      }
    },
    { isActive: focus },
  );

  if (viewportMode && width != null && height != null) {
    const start = scrollOffset;
    const end = Math.min(displayRows.length, scrollOffset + height);
    const slice = displayRows.slice(start, end);
    const cursorGlobalRow = Math.max(0, displayRows.length - 1);
    const showCursorRow =
      focus && cursorGlobalRow >= start && cursorGlobalRow < scrollOffset + height;

    const padLine = (s: string) => (s.length >= width ? s.slice(0, width) : s.padEnd(width, ' '));

    return (
      <Box flexDirection="column" flexGrow={1}>
        <TextViewport
          panelWidth={width + 2}
          viewportHeight={height}
          scrollOffset={scrollOffset}
          totalRows={displayRows.length}
        >
          <Box flexDirection="column" width={width}>
            {slice.map((line, i) => {
              const globalRow = start + i;
              const isCursorRow = showCursorRow && globalRow === cursorGlobalRow;
              const showPlaceholder =
                displayValue === '' && globalRow === 0 && i === 0 && Boolean(placeholder);
              const padded = showPlaceholder
                ? (placeholder ?? '').slice(0, width).padEnd(width, ' ')
                : padLine(line);
              const textBody =
                isCursorRow && cursorOn
                  ? padded.slice(0, Math.max(0, width - 1)).padEnd(width - 1, ' ')
                  : padded;
              const textColW = isCursorRow && cursorOn ? Math.max(1, width - 1) : width;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: viewport slice
                <Box key={`${start}-${i}`} flexDirection="row" width={width}>
                  <Box width={textColW}>
                    <Text dimColor={showPlaceholder} wrap="truncate-end">
                      {textBody}
                    </Text>
                  </Box>
                  {isCursorRow && cursorOn ? <Text inverse>█</Text> : null}
                </Box>
              );
            })}
          </Box>
        </TextViewport>
        {showCharCount ? <Text dimColor>{`${displayValue.length} chars`}</Text> : null}
      </Box>
    );
  }

  const lines = displayValue.length === 0 ? [''] : splitLinesForWrap(displayValue);

  return (
    <Box flexDirection="column" {...(width != null ? { width } : {})}>
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        const showPlaceholder = line === '' && i === 0 && Boolean(placeholder);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: newline-split lines are ordered; keys are stable per render
          <Text key={i} dimColor={showPlaceholder} wrap="wrap">
            {showPlaceholder ? (placeholder ?? '') : line}
            {isLast && focus && cursorOn ? <Text inverse>█</Text> : null}
          </Text>
        );
      })}
      {showCharCount ? <Text dimColor>{`${displayValue.length} chars`}</Text> : null}
    </Box>
  );
}
