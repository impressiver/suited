import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.ts';
import { type SelectItem, SelectList } from './shared/SelectList.tsx';

type PaletteValue = ScreenId | 'help' | 'clear-overlays' | `:${string}`;

export interface CommandPaletteProps {
  active: boolean;
  onClose: () => void;
  onSelectScreen: (screen: ScreenId) => void;
  onHelp: () => void;
  /** Stacked overlay count (`overlayStack.length`); when positive, palette lists close-all. */
  overlayDepth: number;
  /** Clears the overlay stack (`CLEAR_OVERLAYS`); used when the user picks the close-all row. */
  onClearOverlays?: () => void;
  /** The effective screen currently visible; used to show editor-specific commands. */
  currentScreen: ScreenId;
  /** Called when an editor-specific command (`:cmd`) is selected. */
  onCommand?: (command: string) => void;
  /** When true, editor commands are suppressed (overlay active). */
  editorBusy?: boolean;
  /** Terminal width for centering. */
  width: number;
  /** Terminal height for centering. */
  height: number;
}

export function CommandPalette({
  active,
  onClose,
  onSelectScreen,
  onHelp,
  overlayDepth,
  onClearOverlays,
  currentScreen,
  onCommand,
  editorBusy,
  width: termWidth,
  height: termHeight,
}: CommandPaletteProps) {
  useRegisterBlockingUi(active);

  const items = useMemo((): Array<SelectItem<PaletteValue>> => {
    const clearRow: Array<SelectItem<PaletteValue>> =
      overlayDepth > 0
        ? [{ value: 'clear-overlays', label: 'Close overlays / back to underlay' }]
        : [];

    const editorCommands: Array<SelectItem<PaletteValue>> =
      (currentScreen === 'editor' || currentScreen === 'jobs') && !editorBusy
        ? [
            { value: ':qa', label: 'Q&A Refinement' },
            { value: ':polish', label: 'Polish sections (AI)' },
            { value: ':sniff', label: 'AI Sniff (reduce AI phrasing)' },
            { value: ':edit', label: 'Direct AI Edit' },
            { value: ':consultant', label: 'Consultant review (whole profile)' },
            { value: ':history', label: 'Refinement History' },
            { value: ':sections', label: 'Structured Section Editor' },
          ]
        : [];

    const rest = SCREEN_ORDER.map((id) => ({
      value: id,
      label: `Go to ${NAV_LABELS[id]}`,
    }));
    return [
      ...clearRow,
      ...editorCommands,
      ...rest,
      { value: 'help' as const, label: 'Help (? or Ctrl+?)' },
    ];
  }, [overlayDepth, currentScreen, editorBusy]);

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

  const paletteW = 44;
  const paletteH = items.length + 6; // header(2) + paddingY(2) + border(2) + items
  const padX = Math.max(0, Math.floor((termWidth - paletteW) / 2));
  const padY = Math.max(0, Math.floor((termHeight - paletteH) / 2));

  // Solid background: fill the entire terminal so content behind is hidden
  const bgLines = useMemo(
    () => Array.from({ length: termHeight }, () => ' '.repeat(termWidth)),
    [termWidth, termHeight],
  );

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Solid background layer */}
      <Box position="absolute" flexDirection="column" width={termWidth} height={termHeight}>
        {bgLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
      {/* Centered palette */}
      <Box flexDirection="column" paddingX={padX} paddingTop={padY}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
          width={paletteW}
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
                if (typeof item.value === 'string' && item.value.startsWith(':')) {
                  onCommand?.(item.value);
                  onClose();
                  return;
                }
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
                onSelectScreen(item.value as ScreenId);
                onClose();
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
