import { Box, Text } from 'ink';
import { useMemo } from 'react';
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
 * Uses grey colors for a subtle, elegant look.
 * Simplified static rendering to prevent glitching.
 */
export function MarkdownEditorScrollGutter({
  viewportHeight,
  scrollOffset,
  totalLines,
}: MarkdownEditorScrollGutterProps) {
  const noColor = shouldUseNoColor();

  // Calculate thumb position
  const { maxScroll, thumbStart, thumbH } = useMemo(
    () => computeMarkdownEditorScrollThumb(viewportHeight, scrollOffset, totalLines),
    [viewportHeight, scrollOffset, totalLines],
  );

  // Render characters
  const trackCh = noColor ? ':' : '░';
  const thumbCh = noColor ? '#' : '█';
  const idleCh = noColor ? '·' : '│';

  // Generate array of what to render
  const rows = useMemo(() => {
    if (maxScroll === 0) {
      return Array.from({ length: viewportHeight }, () => ({ char: idleCh, isThumb: false }));
    }
    return Array.from({ length: viewportHeight }, (_, r) => {
      const isThumb = r >= thumbStart && r < thumbStart + thumbH;
      return { char: isThumb ? thumbCh : trackCh, isThumb };
    });
  }, [maxScroll, viewportHeight, thumbStart, thumbH, trackCh, thumbCh, idleCh]);

  // Static rendering - no animations, no dynamic updates
  return (
    <Box flexDirection="column" width={1}>
      {rows.map((row, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: row index is stable in fixed-height viewport
        <Box key={`gutter-row-${r}`} width={1}>
          {row.isThumb ? (
            <Text bold color={noColor ? undefined : 'gray'}>
              {row.char}
            </Text>
          ) : (
            <Text color={noColor ? undefined : 'gray'}>{row.char}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
