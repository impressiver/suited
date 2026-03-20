import { Box, Text } from 'ink';
import { type FocusTarget, NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.ts';

export interface SidebarProps {
  activeScreen: ScreenId;
  focusTarget: FocusTarget;
}

export function Sidebar({ activeScreen, focusTarget }: SidebarProps) {
  const sidebarFocused = focusTarget === 'sidebar';

  return (
    <Box flexDirection="column" width={22} marginRight={2}>
      {SCREEN_ORDER.map((id, i) => {
        const n = i + 1;
        const sel = activeScreen === id;
        const rowActive = sidebarFocused && sel;
        return (
          <Box key={id} flexDirection="column">
            {id === 'settings' && (
              <Box>
                <Text dimColor>─────────────</Text>
              </Box>
            )}
            <Box>
              <Text bold={rowActive} dimColor={!rowActive}>
                {rowActive ? (
                  <>
                    <Text color="white">›</Text>
                    <Text> </Text>
                  </>
                ) : (
                  '  '
                )}
                {n} {NAV_LABELS[id]}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
