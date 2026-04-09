import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export interface TextViewportProps {
  /**
   * Total width of the bordered frame in terminal columns — use `panelInnerWidth`, not wider.
   */
  panelWidth: number;
  viewportHeight: number;
  scrollOffset: number;
  totalRows: number;
  /** Shown in the dim status line (e.g. "Read-only"). */
  kind?: string;
  children: ReactNode;
}

/**
 * Bordered panel sized to the main column. Inner text should be wrapped to `panelFramedTextWidth`
 * (panelWidth − 2) so lines match the frame.
 */
export function TextViewport({
  panelWidth,
  viewportHeight,
  scrollOffset,
  totalRows,
  kind,
  children,
}: TextViewportProps) {
  const from = totalRows === 0 ? 0 : scrollOffset + 1;
  const to = Math.min(totalRows, scrollOffset + viewportHeight);
  const scrollHint =
    totalRows <= viewportHeight
      ? `${totalRows} row(s)`
      : `rows ${from}–${to} of ${totalRows} · ↑↓ PgUp/PgDn`;
  const prefix = kind != null && kind !== '' ? `${kind} · ` : '';

  const innerW = Math.max(1, panelWidth - 2);

  return (
    <Box flexDirection="column" width={panelWidth}>
      <Box
        borderStyle="single"
        borderDimColor
        flexDirection="column"
        width={panelWidth}
        overflow="hidden"
      >
        <Box flexDirection="column" width={innerW} overflow="hidden">
          {children}
        </Box>
      </Box>
      <Box marginTop={0}>
        <Text dimColor wrap="truncate">
          {prefix}
          {scrollHint}
        </Text>
      </Box>
    </Box>
  );
}
