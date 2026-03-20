import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedStringCallback } from '../../hooks/useDebouncedStringCallback.ts';
import { useAppDispatch } from '../../store.tsx';

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
}: MultilineInputProps) {
  const dispatch = useAppDispatch();
  const bufferRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [cursorOn, setCursorOn] = useState(true);

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

      if (key.return) {
        bufferRef.current += '\n';
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
        return;
      }

      if (key.backspace || key.delete) {
        bufferRef.current = bufferRef.current.slice(0, -1);
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        bufferRef.current += input;
        setDisplayValue(bufferRef.current);
        scheduleFlush(bufferRef.current);
      }
    },
    { isActive: focus },
  );

  const lines = displayValue.length === 0 ? [''] : displayValue.split('\n');

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
