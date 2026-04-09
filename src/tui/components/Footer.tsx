import { Box, Text } from 'ink';
import type { FocusTarget } from '../types.ts';

export interface FooterProps {
  focusTarget: FocusTarget;
  hint: string;
}

export function Footer({ focusTarget, hint }: FooterProps) {
  const focusLabel = focusTarget === 'sidebar' ? 'nav (left)' : 'panel (right)';
  const baselineLine = `Focus: ${focusLabel} · ? help · q quit · Ctrl+C exit app`;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{baselineLine}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
