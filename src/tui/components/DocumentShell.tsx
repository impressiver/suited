import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export interface DocumentShellProps {
  /** Primary screen label (TopBar line 1). */
  screenTitle: string;
  /** Second TopBar line, e.g. `Job: —` or `Job: acme — Staff Eng`. */
  jobLine: string;
  /** StatusBar left: errors, in-flight ops, etc. */
  statusLeft: string | null;
  /** When true, `statusLeft` is styled as a warning (e.g. load/save errors). */
  statusLeftWarn?: boolean;
  /** StatusBar right: pipeline / health strip (often dim). */
  statusRight: string;
  /** Dim baseline: help, quit, palette. */
  baselineHint: string;
  /** Optional contextual hint from the active panel. */
  contextualHint: string;
  children: ReactNode;
}

/**
 * Document-first chrome: TopBar (screen + job) · main · StatusBar.
 * See specs/tui-document-shell.md.
 */
export function DocumentShell({
  screenTitle,
  jobLine,
  statusLeft,
  statusLeftWarn = false,
  statusRight,
  baselineHint,
  contextualHint,
  children,
}: DocumentShellProps) {
  const left = statusLeft != null && statusLeft !== '' ? statusLeft : ' ';
  return (
    <Box flexDirection="column" padding={1} flexGrow={1} height="100%">
      <Box flexDirection="column">
        <Text bold>{screenTitle}</Text>
        <Text dimColor>{jobLine}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}>
        {children}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Box flexGrow={1} marginRight={1}>
            <Text wrap="truncate-end" color={statusLeftWarn ? 'yellow' : undefined}>
              {left}
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {statusRight}
          </Text>
        </Box>
        <Text dimColor>{baselineHint}</Text>
        {contextualHint !== '' && <Text dimColor>{contextualHint}</Text>}
      </Box>
    </Box>
  );
}
