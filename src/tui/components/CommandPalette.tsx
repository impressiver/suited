import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.ts';
import { type SelectItem, SelectList } from './shared/SelectList.tsx';

type PaletteValue = ScreenId | 'help' | 'clear-overlays';

export interface CommandPaletteProps {
  active: boolean;
  onClose: () => void;
  onSelectScreen: (screen: ScreenId) => void;
  onHelp: () => void;
  /** Stacked overlay count (`overlayStack.length`); when positive, palette lists close-all. */
  overlayDepth: number;
  /** Clears the overlay stack (`CLEAR_OVERLAYS`); used when the user picks the close-all row. */
  onClearOverlays?: () => void;
}

export function CommandPalette({
  active,
  onClose,
  onSelectScreen,
  onHelp,
  overlayDepth,
  onClearOverlays,
}: CommandPaletteProps) {
  useRegisterBlockingUi(active);

  const items = useMemo((): Array<SelectItem<PaletteValue>> => {
    const clearRow: Array<SelectItem<PaletteValue>> =
      overlayDepth > 0
        ? [{ value: 'clear-overlays', label: 'Close overlays / back to underlay' }]
        : [];
    const rest = SCREEN_ORDER.map((id) => ({
      value: id,
      label: `Go to ${NAV_LABELS[id]}`,
    }));
    return [
      ...clearRow,
      ...rest,
      { value: 'help' as const, label: 'Help (? or Ctrl+?)' },
    ];
  }, [overlayDepth]);

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (active) {
      setIdx(0);
    }
  }, [active]);

  useInput(
    (input, key) => {
      if (!active) {
        return;
      }
      if (key.escape || input === ':') {
        onClose();
      }
    },
    { isActive: active },
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      width={40}
    >
      <Text bold>Command palette</Text>
      <Text dimColor>: or Esc close · ↑↓ Enter</Text>
      <Box marginTop={1}>
        <SelectList<PaletteValue>
          items={items}
          selectedIndex={Math.min(idx, items.length - 1)}
          onChange={(i) => setIdx(i)}
          isActive={active}
          onSubmit={(item) => {
            if (item.value === 'clear-overlays') {
              onClearOverlays?.();
              onClose();
              return;
            }
            if (item.value === 'help') {
              onHelp();
              onClose();
              return;
            }
            onSelectScreen(item.value);
            onClose();
          }}
        />
      </Box>
    </Box>
  );
}
