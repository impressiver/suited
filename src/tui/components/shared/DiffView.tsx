import { Box, Text, useInput } from 'ink';
import { useCallback, useState } from 'react';
import type { DiffBlock } from '../../../services/refine.ts';

/** Pure formatter for tests and non-Ink consumers. */
export function formatDiffBlockLines(block: DiffBlock): string[] {
  switch (block.kind) {
    case 'position-bullets': {
      const header = `${block.title} @ ${block.company}`;
      const out: string[] = [header];
      for (const b of block.oldBullets) {
        out.push(`- ${b}`);
      }
      for (const b of block.newBullets) {
        out.push(`+ ${b}`);
      }
      return out;
    }
    case 'summary': {
      const out: string[] = ['Summary'];
      if (block.old !== undefined) out.push(`- ${block.old}`);
      out.push(`+ ${block.new}`);
      return out;
    }
    case 'skills-replaced': {
      return [
        'Skills (replaced)',
        `- ${block.oldNames.join(', ')}`,
        `+ ${block.newNames.join(', ')}`,
      ];
    }
    case 'skills-added': {
      return [`Added skills: ${block.names.join(', ')}`];
    }
  }
}

function blockLabel(block: DiffBlock): string {
  switch (block.kind) {
    case 'position-bullets':
      return `${block.title} @ ${block.company}`;
    case 'summary':
      return 'Summary';
    case 'skills-replaced':
      return 'Skills (replaced)';
    case 'skills-added':
      return 'Skills (added)';
  }
}

export interface DiffViewProps {
  blocks: DiffBlock[];
}

/** Read-only diff view (no interaction). */
export function DiffView({ blocks }: DiffViewProps) {
  return (
    <Box flexDirection="column">
      {blocks.map((block, bi) => {
        const lines = formatDiffBlockLines(block);
        const blockKey =
          block.kind === 'position-bullets' ? `pos-${block.positionId}` : `${block.kind}-${bi}`;
        return (
          <Box key={blockKey} flexDirection="column" marginBottom={1}>
            {lines.map((line, li) => {
              const trimmed = line.trimStart();
              if (trimmed.startsWith('-')) {
                return (
                  <Text key={`${blockKey}-${li}`} backgroundColor="red" color="white">
                    {line}
                  </Text>
                );
              }
              if (trimmed.startsWith('+')) {
                return (
                  <Text key={`${blockKey}-${li}`} backgroundColor="green" color="white">
                    {line}
                  </Text>
                );
              }
              return (
                <Text key={`${blockKey}-${li}`} bold>
                  {line}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Interactive diff review — per-block accept/reject
// ---------------------------------------------------------------------------

export interface InteractiveDiffReviewProps {
  blocks: DiffBlock[];
  isActive: boolean;
  /** Called with the set of accepted block indices when the user confirms. */
  onConfirm: (accepted: Set<number>) => void;
  /** Called when the user cancels the review. */
  onCancel: () => void;
}

/**
 * Interactive diff reviewer. Each block can be individually toggled (accepted/rejected).
 * ↑↓ navigates blocks, Space toggles, Enter confirms, Esc cancels.
 */
export function InteractiveDiffReview({
  blocks,
  isActive,
  onConfirm,
  onCancel,
}: InteractiveDiffReviewProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(blocks.map((_, i) => i)));

  const toggle = useCallback(
    (idx: number) => {
      setAccepted((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) {
          next.delete(idx);
        } else {
          next.add(idx);
        }
        return next;
      });
    },
    [],
  );

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setFocusIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setFocusIdx((i) => Math.min(blocks.length - 1, i + 1));
        return;
      }
      if (input === ' ') {
        toggle(focusIdx);
        return;
      }
      if (input === 'a') {
        setAccepted(new Set(blocks.map((_, i) => i)));
        return;
      }
      if (input === 'n') {
        setAccepted(new Set());
        return;
      }
      if (key.return) {
        onConfirm(accepted);
        return;
      }
      if (key.escape) {
        onCancel();
      }
    },
    { isActive },
  );

  const acceptedCount = accepted.size;
  const totalCount = blocks.length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text bold>
          Review changes ({acceptedCount}/{totalCount} accepted)
        </Text>
        <Text dimColor>↑↓ navigate · Space toggle · a accept all · n reject all · Enter confirm · Esc cancel</Text>
      </Box>

      {blocks.map((block, bi) => {
        const isFocused = bi === focusIdx;
        const isAccepted = accepted.has(bi);
        const lines = formatDiffBlockLines(block);
        const blockKey =
          block.kind === 'position-bullets' ? `pos-${block.positionId}` : `${block.kind}-${bi}`;

        return (
          <Box
            key={blockKey}
            flexDirection="column"
            marginBottom={1}
            borderStyle={isFocused ? 'round' : undefined}
            borderColor={isFocused ? (isAccepted ? 'green' : 'red') : undefined}
            paddingX={isFocused ? 1 : 0}
          >
            {/* Block header with accept/reject indicator */}
            <Box>
              <Text
                color={isAccepted ? 'green' : 'red'}
                bold={isFocused}
              >
                {isAccepted ? '  ✓ ' : '  ✗ '}
              </Text>
              <Text bold={isFocused} dimColor={!isFocused}>
                {blockLabel(block)}
              </Text>
              {!isAccepted && (
                <Text dimColor> (rejected)</Text>
              )}
            </Box>

            {/* Diff lines */}
            {lines.slice(1).map((line, li) => {
              const trimmed = line.trimStart();
              const dimmed = !isAccepted;
              if (trimmed.startsWith('-')) {
                return (
                  <Text
                    key={`${blockKey}-${li}`}
                    backgroundColor={dimmed ? undefined : 'red'}
                    color={dimmed ? 'gray' : 'white'}
                    dimColor={dimmed}
                    strikethrough={dimmed}
                  >
                    {'    '}{line}
                  </Text>
                );
              }
              if (trimmed.startsWith('+')) {
                return (
                  <Text
                    key={`${blockKey}-${li}`}
                    backgroundColor={dimmed ? undefined : 'green'}
                    color={dimmed ? 'gray' : 'white'}
                    dimColor={dimmed}
                    strikethrough={dimmed}
                  >
                    {'    '}{line}
                  </Text>
                );
              }
              return (
                <Text key={`${blockKey}-${li}`} dimColor={dimmed}>
                  {'    '}{line}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
