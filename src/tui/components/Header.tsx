import { Box, Text } from 'ink';

export interface HeaderProps {
  name: string | null;
  positionCount: number;
  skillCount: number;
  hasRefined: boolean;
  hasSource: boolean;
  /** Same semantics as Dashboard pipeline row (●/○ markers). */
  pipelineStrip: string;
  /** When true, append a subtle working hint (does not hide identity). */
  operationInProgress?: boolean;
}

export function Header({
  name,
  positionCount,
  skillCount,
  hasRefined,
  hasSource,
  pipelineStrip,
  operationInProgress,
}: HeaderProps) {
  const refinedMark = hasSource ? (hasRefined ? 'refined ✓' : 'not refined') : '—';
  const title = name ?? '(no profile loaded)';
  const stats =
    hasSource && name
      ? `${positionCount} positions · ${skillCount} skills · ${refinedMark}`
      : refinedMark;
  const working = operationInProgress ? ' · …' : '';

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          Suited · {title} · {stats}
          {working}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>{pipelineStrip}</Text>
      </Box>
    </Box>
  );
}
