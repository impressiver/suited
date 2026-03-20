import { Box, Text } from 'ink';

/**
 * Inline refinement (Q&A, diff review, streaming) per specs/tui-screens.md — not fully implemented yet.
 */
export function RefineScreen() {
  return (
    <Box flexDirection="column">
      <Text bold>Refine</Text>
      <Text dimColor>
        This screen will host the full refinement flow (questions, diff review, polish, consultant) inside the TUI.
      </Text>
      <Text dimColor>Tracked in specs/tui-implementation-order.md §10.</Text>
    </Box>
  );
}
