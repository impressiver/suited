import { Box, Text } from 'ink';
import type { DiffBlock } from '../../../services/refine.js';

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

export interface DiffViewProps {
  blocks: DiffBlock[];
}

export function DiffView({ blocks }: DiffViewProps) {
  return (
    <Box flexDirection="column">
      {blocks.map((block, bi) => {
        const lines = formatDiffBlockLines(block);
        const blockKey =
          block.kind === 'position-bullets' ? `pos-${block.positionId}` : `${block.kind}-${bi}`;
        return (
          <Box key={blockKey} flexDirection="column" marginBottom={1}>
            {lines.map((line) => {
              const trimmed = line.trimStart();
              if (trimmed.startsWith('-')) {
                return (
                  <Text key={`${blockKey}-d-${line}`} color="red">
                    {line}
                  </Text>
                );
              }
              if (trimmed.startsWith('+')) {
                return (
                  <Text key={`${blockKey}-a-${line}`} color="green">
                    {line}
                  </Text>
                );
              }
              return (
                <Text key={`${blockKey}-n-${line}`} bold>
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
