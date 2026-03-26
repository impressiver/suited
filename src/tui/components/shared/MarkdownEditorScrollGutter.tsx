import { Box, Text } from 'ink';
import { shouldUseNoColor } from '../../env.ts';

/** Pure math for a line-based vertical scroll thumb inside a fixed-height track. */
export function computeMarkdownEditorScrollThumb(
  viewportHeight: number,
  scrollOffset: number,
  totalLines: number,
): { maxScroll: number; thumbStart: number; thumbH: number } {
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  if (maxScroll === 0) {
    return { maxScroll: 0, thumbStart: 0, thumbH: 0 };
  }
  const thumbH = Math.max(
    1,
    Math.min(viewportHeight, Math.round((viewportHeight * viewportHeight) / totalLines)),
  );
  const travel = viewportHeight - thumbH;
  const thumbStart =
    travel <= 0
      ? 0
      : Math.max(0, Math.min(travel, Math.round((scrollOffset / maxScroll) * travel)));
  return { maxScroll, thumbStart, thumbH };
}

export interface MarkdownEditorScrollGutterProps {
  viewportHeight: number;
  scrollOffset: number;
  totalLines: number;
}

/**
 * Single-column scrollbar-style hint to the right of the markdown editor text.
 */
export function MarkdownEditorScrollGutter({
  viewportHeight,
  scrollOffset,
  totalLines,
}: MarkdownEditorScrollGutterProps) {
  const noColor = shouldUseNoColor();
  const { maxScroll, thumbStart, thumbH } = computeMarkdownEditorScrollThumb(
    viewportHeight,
    scrollOffset,
    totalLines,
  );

  const trackCh = noColor ? ':' : '▒';
  const thumbCh = noColor ? '#' : '█';
  const idleCh = noColor ? '·' : '│';

  return (
    <Box flexDirection="column" width={1}>
      {Array.from({ length: viewportHeight }, (_, r) => {
        const isThumb = maxScroll > 0 && r >= thumbStart && r < thumbStart + thumbH;
        if (maxScroll === 0) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed viewport slice
            <Box key={r} width={1}>
              <Text dimColor>{idleCh}</Text>
            </Box>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed viewport slice
          <Box key={r} width={1}>
            {isThumb ? (
              noColor ? (
                <Text bold>{thumbCh}</Text>
              ) : (
                <Text bold color="cyan">
                  {thumbCh}
                </Text>
              )
            ) : (
              <Text dimColor>{trackCh}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
