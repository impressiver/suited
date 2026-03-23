import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { NAV_LABELS, SCREEN_ORDER } from '../types.ts';
import { ScrollView } from './shared/ScrollView.tsx';

export interface ShortcutHelpOverlayProps {
  width: number;
  height: number;
  onClose: () => void;
}

/**
 * Full-screen shortcut reference; Esc or ? closes.
 */
export function ShortcutHelpOverlay({ width, height, onClose }: ShortcutHelpOverlayProps) {
  const [scroll, setScroll] = useState(0);

  const lines = useMemo(() => {
    const out: string[] = [];
    out.push('Shortcuts (Esc or ? to close)');
    out.push('');
    out.push('Global');
    out.push('  : — command palette (Esc or : to close)');
    out.push('  Esc — back to Resume, or one level in wizards (see per-screen)');
    out.push('  ↑↓ — change screen, or move in lists / scroll when the panel owns arrows');
    const n = SCREEN_ORDER.length;
    out.push(`  1–${n} — jump to screen (legacy order; same as palette)`);
    out.push(
      '  d / i / c / j / r / g / s — Resume, Import, Contact, Jobs, Refine, Generate, Settings',
    );
    out.push(
      '  Resume (refined markdown): Esc — leave editor focus for jumps & palette; Tab — focus editor again',
    );
    out.push('  p — Jobs: prepare (when that screen has focus; not a global jump)');
    out.push('  ? / Ctrl+? — this help');
    out.push('  q — quit');
    out.push('  Ctrl+C — force exit the process');
    out.push('');
    out.push('Screen order (palette)');
    for (let i = 0; i < SCREEN_ORDER.length; i++) {
      const id = SCREEN_ORDER[i];
      out.push(`  ${i + 1}. ${NAV_LABELS[id]}`);
    }
    out.push('');
    out.push(
      'Profile editor (from Refine) and some screens defer s to mean Save; Settings uses s to save keys.',
    );
    out.push('Per-screen keys: see specs/tui-screens.md');
    return out;
  }, []);

  const innerW = Math.max(20, width - 2);
  const viewH = Math.max(6, height - 4);

  useInput(
    (input, key) => {
      if (key.escape || input === '?' || (key.ctrl && (input === '?' || input === '/'))) {
        onClose();
        return;
      }
      if (key.pageUp) {
        setScroll((s) => Math.max(0, s - Math.max(1, viewH - 1)));
        return;
      }
      if (key.pageDown) {
        setScroll((s) => Math.min(Math.max(0, lines.length - viewH), s + Math.max(1, viewH - 1)));
        return;
      }
      if (key.upArrow) {
        setScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setScroll((s) => Math.min(Math.max(0, lines.length - viewH), s + 1));
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" width={width} height={height} padding={1}>
      <Box marginBottom={1}>
        <Text bold>Suited — keyboard help</Text>
      </Box>
      <ScrollView lines={lines} height={viewH} scrollOffset={scroll} wrapWidth={innerW} />
      <Box marginTop={1}>
        <Text dimColor>PgUp/PgDn · ↑↓ scroll · Esc or ? close</Text>
      </Box>
    </Box>
  );
}
