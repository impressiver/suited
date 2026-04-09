import { Box, Text, useInput } from 'ink';
import { useRegisterBlockingUi } from '../../hooks/useRegisterBlockingUi.ts';

export interface ConfirmPromptProps {
  message: string;
  /** When true, y/n/Enter/Esc are handled here. */
  active: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * When false, does not increment `blockingUiDepth` (e.g. App-level navigate-away confirm,
   * which already disables global `useInput` via `pendingNav`).
   */
  registerBlocking?: boolean;
}

/**
 * Yes/no confirm. Enter / y = confirm; Esc / n = cancel (per architecture footer).
 */
export function ConfirmPrompt({
  message,
  active,
  onConfirm,
  onCancel,
  registerBlocking = true,
}: ConfirmPromptProps) {
  useRegisterBlockingUi(active && registerBlocking);
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
