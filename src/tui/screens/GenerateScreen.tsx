import { Box, Text } from 'ink';

/**
 * Generate pipeline per specs/tui-screens.md — not fully implemented yet.
 */
export function GenerateScreen() {
  return (
    <Box flexDirection="column">
      <Text bold>Generate</Text>
      <Text dimColor>
        This screen will run JD analysis, curation, polish, consulting, trim, and PDF export inline.
      </Text>
      <Text dimColor>Tracked in specs/tui-implementation-order.md §11.</Text>
    </Box>
  );
}
