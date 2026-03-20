import { Box, Text } from 'ink';

export interface ProgressStepsProps {
  steps: string[];
  /** Zero-based index of the active step. */
  currentIndex: number;
}

export function ProgressSteps({ steps, currentIndex }: ProgressStepsProps) {
  return (
    <Box flexDirection="column">
      {steps.map((label, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const prefix = done ? '✓' : active ? '●' : '○';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: step order is fixed
          <Text key={i} dimColor={!done && !active} bold={active}>
            {prefix} {i + 1}. {label}
          </Text>
        );
      })}
    </Box>
  );
}
