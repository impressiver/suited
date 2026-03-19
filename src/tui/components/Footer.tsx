import { Box, Text } from 'ink';
import type { FocusTarget } from '../types.js';

export interface FooterProps {
  focusTarget: FocusTarget;
  hint: string;
}

export function Footer({ focusTarget, hint }: FooterProps) {
  const focusLabel = focusTarget === 'sidebar' ? 'nav (left)' : 'panel (right)';
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Focus: {focusLabel} · {hint}
      </Text>
    </Box>
  );
}
