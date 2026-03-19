import { Box, Text } from 'ink';
import type { FocusTarget } from '../types.js';

export interface FooterProps {
  focusTarget: FocusTarget;
  hint: string;
}

export function Footer({ focusTarget, hint }: FooterProps) {
  const focusLabel = focusTarget === 'sidebar' ? 'sidebar' : 'content';
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Focus: {focusLabel} · {hint}
      </Text>
    </Box>
  );
}
