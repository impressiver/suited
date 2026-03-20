import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedStringCallback } from '../../hooks/useDebouncedStringCallback.ts';
import { useAppDispatch } from '../../store.tsx';

const DEBOUNCE_MS = 16;

export interface MultilineInputProps {
  value: string;
  onChange: (value: string) => void;
  /** When true, captures keys (and sets text-input gate). */
  focus: boolean;
  placeholder?: string;
  /** Called on Ctrl+D (done). */
  onSubmit?: (value: string) => void;
  /** Shown from debounced value (not per-keystroke live count). */
  showCharCount?: boolean;
}

/**
 * Multiline field with ref-buffered input and debounced `onChange` (paste-friendly).
 * Ctrl+D submits; Enter inserts newline; Esc is left to parent / global handler.
 */
export function MultilineInput({
  value,
  onChange,
  focus,
  placeholder,
  onSubmit,
  showCharCount,
}: MultilineInputProps) {
  const dispatch = useAppDispatch();
  const bufferRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);

  const flush = useDebouncedStringCallback(onChange, DEBOUNCE_MS);

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

  useInput(
    (input, key) => {
      if (!focus) return;

      if (key.ctrl && input === 'd') {
        onSubmit?.(bufferRef.current);
        return;
      }

      if (key.return) {
        bufferRef.current += '\n';
        setDisplayValue(bufferRef.current);
        flush(bufferRef.current);
        return;
      }

      if (key.backspace || key.delete) {
        bufferRef.current = bufferRef.current.slice(0, -1);
        setDisplayValue(bufferRef.current);
        flush(bufferRef.current);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        bufferRef.current += input;
        setDisplayValue(bufferRef.current);
        flush(bufferRef.current);
      }
    },
    { isActive: focus },
  );

  const lines = displayValue.length === 0 ? [''] : displayValue.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: newline-split lines are ordered; keys are stable per render
        <Text key={i} dimColor={!line && Boolean(placeholder)}>
          {line || (i === 0 ? (placeholder ?? '') : '')}
        </Text>
      ))}
      {showCharCount ? <Text dimColor>{`${displayValue.length} chars`}</Text> : null}
    </Box>
  );
}
