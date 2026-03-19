import { Box, Text } from 'ink';
import { NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.js';

export interface SidebarProps {
  activeScreen: ScreenId;
}

export function Sidebar({ activeScreen }: SidebarProps) {
  return (
    <Box flexDirection="column" width={22} marginRight={2}>
      {SCREEN_ORDER.map((id, i) => {
        const n = i + 1;
        const sel = activeScreen === id;
        // Always mark the active row so it stays visible when focus is on the right panel.
        const mark = sel ? '▸ ' : '  ';
        return (
          <Box key={id}>
            <Text bold={sel} dimColor={!sel}>
              {mark}
              {n} {NAV_LABELS[id]}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
