import { Box, Text } from 'ink';
import { type FocusTarget, NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.js';

export interface SidebarProps {
  activeScreen: ScreenId;
  focusTarget: FocusTarget;
}

export function Sidebar({ activeScreen, focusTarget }: SidebarProps) {
  const inSidebar = focusTarget === 'sidebar';
  return (
    <Box flexDirection="column" width={22} marginRight={2}>
      {SCREEN_ORDER.map((id, i) => {
        const n = i + 1;
        const sel = activeScreen === id;
        const mark = sel && inSidebar ? '▸ ' : '  ';
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
