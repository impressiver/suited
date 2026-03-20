import { Box, Text, useInput } from 'ink';

export interface ConfirmPromptProps {
  message: string;
  /** When true, y/n/Enter/Esc are handled here. */
  active: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Yes/no confirm. Enter / y = confirm; Esc / n = cancel (per architecture footer).
 */
export function ConfirmPrompt({ message, active, onConfirm, onCancel }: ConfirmPromptProps) {
  useInput(
    (input, key) => {
      if (!active) return;
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        onConfirm();
        return;
      }
      const ch = input.toLowerCase();
      if (ch === 'y') {
        onConfirm();
        return;
      }
      if (ch === 'n') {
        onCancel();
      }
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column">
      <Text bold>{message}</Text>
      <Text dimColor>Enter / y = yes · n / Esc = no</Text>
    </Box>
  );
}
