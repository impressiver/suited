import { Box, Text } from 'ink';

export interface ScrollViewProps {
  lines: string[];
  /** Height in terminal rows (lines shown). */
  height: number;
  /** Zero-based row offset into `lines`. */
  scrollOffset?: number;
}

export function ScrollView({ lines, height, scrollOffset = 0 }: ScrollViewProps) {
  const end = Math.min(lines.length, scrollOffset + height);
  const slice = lines.slice(scrollOffset, end);
  return (
    <Box flexDirection="column">
      {slice.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: slice window is stable for this render
        <Text key={scrollOffset + i}>{line}</Text>
      ))}
    </Box>
  );
}
