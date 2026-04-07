import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { NAV_LABELS, SCREEN_ORDER, type ScreenId } from '../types.ts';
import { ScrollView } from './shared/ScrollView.tsx';

export interface HelpDialogProps {
  width: number;
  height: number;
  onClose: () => void;
  _currentScreen?: ScreenId;
}

interface CommandGroup {
  title: string;
  commands: { key: string; desc: string }[];
}

/**
 * Centered help dialog / cheatsheet overlay.
 * Shows all commands in a clean, organized reference.
 * Press ? to open, Esc or ? to close.
 */
export function HelpDialog({ width, height, onClose, _currentScreen }: HelpDialogProps) {
  const [scroll, setScroll] = useState(0);

  const commandGroups: CommandGroup[] = useMemo(() => {
    return [
      {
        title: 'Global',
        commands: [
          { key: '?', desc: 'Open this help dialog' },
          { key: 'Esc', desc: 'Close dialog / Go back / Cancel operation' },
          { key: ':', desc: 'Command palette' },
          { key: 'q', desc: 'Quit' },
          { key: 'Ctrl+C', desc: 'Force exit' },
        ],
      },
      {
        title: 'Navigation',
        commands: [
          { key: '↑↓', desc: 'Change screen (when not in editor/list)' },
          { key: '1-7', desc: 'Jump to screen by number' },
          { key: 'd', desc: 'Dashboard (Resume)' },
          { key: 'i', desc: 'Import' },
          { key: 'c', desc: 'Contact' },
          { key: 'j', desc: 'Jobs' },
          { key: 'r', desc: 'Refine' },
          { key: 'g', desc: 'Generate' },
          { key: 's', desc: 'Settings' },
        ],
      },
      {
        title: 'Editor',
        commands: [
          { key: '↑↓←→', desc: 'Move cursor' },
          { key: 'Esc', desc: 'Exit edit mode / Navigation' },
          { key: 'Ctrl+S', desc: 'Save changes' },
          { key: 'Ctrl+P', desc: 'Polish section' },
          { key: 'Ctrl+E', desc: 'Consultant review' },
          { key: 'Ctrl+O', desc: 'Open outline' },
          { key: 'Tab', desc: 'Toggle focus' },
        ],
      },
      {
        title: 'Lists & Selection',
        commands: [
          { key: '↑↓', desc: 'Navigate items' },
          { key: 'Space', desc: 'Toggle selection' },
          { key: 'Enter', desc: 'Confirm / Select' },
        ],
      },
      {
        title: 'Screens',
        commands: SCREEN_ORDER.map((id, i) => ({
          key: `${i + 1}`,
          desc: NAV_LABELS[id],
        })),
      },
    ];
  }, []);

  const lines = useMemo(() => {
    const out: string[] = [];
    out.push('');
    out.push('  ┌─────────────────────────────────────────────────────────────┐');
    out.push('  │                    SUITED KEYBOARD REFERENCE                  │');
    out.push('  └─────────────────────────────────────────────────────────────┘');
    out.push('');

    for (const group of commandGroups) {
      // Group header
      out.push(`  ${group.title}`);
      out.push(`  ${'─'.repeat(62)}`);

      // Commands - two columns
      for (let i = 0; i < group.commands.length; i += 2) {
        const cmd1 = group.commands[i];
        const cmd2 = group.commands[i + 1];

        const left = `  ${cmd1.key.padStart(8)}  ${cmd1.desc}`;
        if (cmd2) {
          const right = `${cmd2.key.padStart(8)}  ${cmd2.desc}`;
          out.push(`${left.padEnd(36)}${right}`);
        } else {
          out.push(left);
        }
      }
      out.push('');
    }

    out.push('  ┌─────────────────────────────────────────────────────────────┐');
    out.push('  │  Press ? or Esc to close this dialog                        │');
    out.push('  └─────────────────────────────────────────────────────────────┘');
    out.push('');

    return out;
  }, [commandGroups]);

  // Dialog dimensions - centered overlay
  const dialogWidth = Math.min(68, width - 4);
  const dialogHeight = Math.min(36, height - 4);
  const paddingX = Math.max(0, Math.floor((width - dialogWidth) / 2));
  const paddingY = Math.max(0, Math.floor((height - dialogHeight) / 2));

  const innerW = dialogWidth - 2;
  const viewH = dialogHeight - 4;

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
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={paddingX}
      paddingY={paddingY}
    >
      <Box
        flexDirection="column"
        width={dialogWidth}
        height={dialogHeight}
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Suited
          </Text>
          <Text dimColor> — Help</Text>
        </Box>
        <ScrollView lines={lines} height={viewH} scrollOffset={scroll} wrapWidth={innerW} />
        <Box marginTop={1}>
          <Text dimColor>PgUp/PgDn · ↑↓ scroll · ? or Esc close</Text>
        </Box>
      </Box>
    </Box>
  );
}
