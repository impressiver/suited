import { Box, Text } from 'ink';

/**
 * Profile editor per specs/tui-screens.md — not fully implemented yet.
 */
export function ProfileEditorScreen() {
  return (
    <Box flexDirection="column">
      <Text bold>Improve profile</Text>
      <Text dimColor>
        This screen will provide the section/position/bullet editor with inline save and navigation stack.
      </Text>
      <Text dimColor>Tracked in specs/tui-implementation-order.md §9.</Text>
    </Box>
  );
}
