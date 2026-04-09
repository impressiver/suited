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
          { key: 'd', desc: 'Dashboard' },
          { key: 'i', desc: 'Import' },
          { key: 'c', desc: 'Contact' },
          { key: 'e', desc: 'Editor' },
          { key: 'j', desc: 'Jobs' },
          { key: 'g', desc: 'Generate' },
          { key: 's', desc: 'Settings' },
        ],
      },
      {
        title: 'Editor',
        commands: [
          { key: '↑↓←→', desc: 'Move cursor' },
          { key: 'Esc', desc: 'Exit edit mode / nav mode' },
          { key: 'Tab', desc: 'Re-enter edit mode' },
          { key: 'Ctrl+S', desc: 'Save changes' },
          { key: 'Ctrl+P', desc: 'Polish section (inline)' },
          { key: 'Ctrl+E', desc: 'Consultant review (section)' },
          { key: 'Ctrl+O', desc: 'Open outline' },
          { key: 'o', desc: 'Outline (nav mode)' },
          { key: 'Ctrl+J', desc: 'Toggle JD pane (job mode)' },
        ],
      },
      {
        title: 'Editor Palette Commands',
        commands: [
          { key: ':qa', desc: 'Q&A Refinement' },
          { key: ':polish', desc: 'Polish sections (AI)' },
          { key: ':sniff', desc: 'AI Sniff (reduce AI phrasing)' },
          { key: ':edit', desc: 'Direct AI Edit' },
          { key: ':consultant', desc: 'Consultant review (whole)' },
          { key: ':history', desc: 'Refinement History' },
          { key: ':sections', desc: 'Structured Section Editor' },
        ],
      },
      {
        title: 'Job Editor',
        commands: [
          { key: 'p', desc: 'Prepare for job' },
          { key: 'f', desc: 'Professional feedback' },
          { key: 'g', desc: 'Generate PDF for job' },
          { key: 'l', desc: 'Cover letter' },
        ],
      },
      {
        title: 'Diff Review',
        commands: [
          { key: '↑↓', desc: 'Navigate blocks' },
          { key: 'Space', desc: 'Toggle accept/reject' },
          { key: 'a', desc: 'Accept all blocks' },
          { key: 'n', desc: 'Reject all blocks' },
          { key: 'Enter', desc: 'Confirm selection' },
          { key: 'Esc', desc: 'Cancel / discard' },
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
    out.push('  SUITED KEYBOARD REFERENCE');
    out.push('');

    for (let gi = 0; gi < commandGroups.length; gi++) {
      const group = commandGroups[gi];
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
      // Extra blank line between sections
      if (gi < commandGroups.length - 1) {
        out.push('');
      }
    }

    out.push('  Press ? or Esc to close this dialog');
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
