import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { panelFramedTextWidth, panelInnerWidth } from '../panelContentWidth.ts';
import { ScrollView, TextViewport } from './shared/index.ts';
import { linesToWrappedRows, splitLinesForWrap, wrappedScrollMax } from '../utils/wrapTextRows.ts';

export type JdPaneMode = 'hidden' | 'peek' | 'full';

export interface JdPaneProps {
  jobDescription: string;
  mode: JdPaneMode;
  peekHeight: number;
  fullHeight: number;
  isActive: boolean;
}

export function JdPane({ jobDescription, mode, peekHeight, fullHeight, isActive }: JdPaneProps) {
  const [cols] = useTerminalSize();
  const textW = panelFramedTextWidth(cols);
  const panelW = panelInnerWidth(cols);
  const [scroll, setScroll] = useState(0);

  const sourceLines = useMemo(() => splitLinesForWrap(jobDescription), [jobDescription]);
  const wrappedRows = useMemo(() => linesToWrappedRows(sourceLines, textW), [sourceLines, textW]);

  const viewH = mode === 'peek' ? peekHeight : fullHeight;
  const maxScroll = wrappedScrollMax(sourceLines, viewH, textW);

  useInput(
    (_input, key) => {
      const step = Math.max(1, viewH - 1);
      if (key.pageUp) {
        setScroll((s) => Math.max(0, s - step));
      }
      if (key.pageDown) {
        setScroll((s) => Math.min(maxScroll, s + step));
      }
      if (key.upArrow) {
        setScroll((s) => Math.max(0, s - 1));
      }
      if (key.downArrow) {
        setScroll((s) => Math.min(maxScroll, s + 1));
      }
    },
    { isActive: isActive && mode !== 'hidden' },
  );

  if (mode === 'hidden') {
    return (
      <Box>
        <Text dimColor>Ctrl+J: show job description</Text>
      </Box>
    );
  }

  const displayLines = wrappedRows;

  return (
    <Box flexDirection="column" flexGrow={mode === 'full' ? 1 : 0} minHeight={0}>
      <TextViewport
        panelWidth={panelW}
        viewportHeight={viewH}
        scrollOffset={Math.min(scroll, maxScroll)}
        totalRows={displayLines.length}
        kind="Job Description"
      >
        <ScrollView
          displayLines={displayLines}
          height={viewH}
          scrollOffset={Math.min(scroll, maxScroll)}
          padToWidth={textW}
        />
      </TextViewport>
    </Box>
  );
}
