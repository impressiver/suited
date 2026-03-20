import { Box, Text } from 'ink';
import { TextInput } from './TextInput.tsx';

export interface InlineEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** When true, show `TextInput`; otherwise read-only line. */
  isEditing: boolean;
  /** Must be true when `isEditing` so ink-text-input receives keys. */
  inputFocused: boolean;
  emptyLabel?: string;
  onSubmit?: (value: string) => void;
}

/**
 * Read-only line vs single-line edit — for bullet/summary edits (full profile editor defers to Phase C).
 */
export function InlineEditor({
  value,
  onChange,
  isEditing,
  inputFocused,
  emptyLabel = '(empty)',
  onSubmit,
}: InlineEditorProps) {
  if (!isEditing) {
    return <Text dimColor={!value}>{value || emptyLabel}</Text>;
  }

  return (
    <Box>
      <TextInput value={value} onChange={onChange} focus={inputFocused} onSubmit={onSubmit} />
    </Box>
  );
}
