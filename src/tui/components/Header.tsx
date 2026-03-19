import { Box, Text } from 'ink';

export interface HeaderProps {
  name: string | null;
  positionCount: number;
  skillCount: number;
  hasRefined: boolean;
  hasSource: boolean;
}

export function Header({ name, positionCount, skillCount, hasRefined, hasSource }: HeaderProps) {
  const refinedMark = hasSource ? (hasRefined ? 'refined ✓' : 'not refined') : '—';
  const title = name ?? '(no profile loaded)';
  const stats =
    hasSource && name
      ? `${positionCount} positions · ${skillCount} skills · ${refinedMark}`
      : refinedMark;

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold>
        Suited · {title} · {stats}
      </Text>
    </Box>
  );
}
