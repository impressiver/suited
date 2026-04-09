import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { ScreenId } from '../types.ts';
import { ContextBar } from './ContextBar.tsx';
import type { Notification } from './StatusBarNotifications.tsx';
import { StatusBarNotifications } from './StatusBarNotifications.tsx';
import { TitleBar } from './TitleBar.tsx';

export interface StatusHealthIndicator {
  status: 'ok' | 'warn' | 'error' | 'neutral';
  label: string;
  icon: string;
}

export interface PipelineIndicator {
  hasSource: boolean;
  hasRefined: boolean;
  hasJobs: boolean;
  hasPdf: boolean;
}

export interface ElegantShellProps {
  /** Current screen identifier for title bar */
  activeScreen: ScreenId;
  /** Job context for title bar */
  jobLine: string;
  /** Optional additional context for title bar */
  contextInfo?: string | null;
  /** Context target for the context bar (e.g., job name) */
  contextTarget?: string | null;
  /** Currently selected section */
  selectedSection?: string | null;
  /** Combined status/health/validation indicator */
  statusIndicator?: StatusHealthIndicator | null;
  /** Pipeline indicators */
  pipeline?: PipelineIndicator | null;
  /** Notifications to show (max 2 lines) */
  notifications?: Notification[];
  /** Available width for notifications */
  notificationWidth?: number;
  /** Available terminal width */
  width: number;
  /** Available terminal height */
  height: number;
  /** Children content */
  children: ReactNode;
}

/**
 * Elegant document shell with:
 * - Title bar (logo left, screen/job/context right)
 * - Context bar (screen :: context :: selected section)
 * - Main content area
 * - Two-line status bar at bottom (notifications left, indicators right)
 *
 * Clean, minimal design inspired by OpenCode.
 */
export function ElegantShell({
  activeScreen,
  jobLine,
  contextInfo,
  contextTarget,
  selectedSection,
  statusIndicator,
  pipeline,
  notifications,
  notificationWidth = 60,
  width,
  height,
  children,
}: ElegantShellProps) {
  // Get status indicator color
  const getStatusColor = () => {
    if (!statusIndicator) return undefined;
    switch (statusIndicator.status) {
      case 'ok':
        return 'green';
      case 'warn':
        return 'yellow';
      case 'error':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Box flexDirection="column" width={width} height={height} padding={1}>
      {/* Title Bar with Logo - fixed height */}
      <TitleBar
        activeScreen={activeScreen}
        jobLine={jobLine}
        contextInfo={contextInfo}
        width={width - 2}
      />

      {/* Context Bar: Screen :: Context :: Selected Section - fixed height */}
      <ContextBar
        activeScreen={activeScreen}
        contextTarget={contextTarget}
        selectedSection={selectedSection}
        width={width - 2}
      />

      {/* Separator line */}
      <Box marginY={1} height={1}>
        <Text dimColor>{'─'.repeat(width - 2)}</Text>
      </Box>

      {/* Main Content Area - fills remaining space */}
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        {children}
      </Box>

      {/* Separator line */}
      <Box marginY={1} height={1}>
        <Text dimColor>{'─'.repeat(width - 2)}</Text>
      </Box>

      {/* Two-line Status Bar - fixed height */}
      <Box flexDirection="row" width={width - 2} height={2}>
        {/* Left: Notifications (2 lines, no scroll) */}
        <Box flexGrow={1} marginRight={1} height={2}>
          <StatusBarNotifications notifications={notifications ?? []} width={notificationWidth} />
        </Box>

        {/* Right: Status indicator + Pipeline + ? help (centered vertically) */}
        <Box flexDirection="column" justifyContent="center" height={2}>
          <Box flexDirection="row">
            {statusIndicator && (
              <Box marginRight={2}>
                <Text color={getStatusColor()} bold>
                  {statusIndicator.icon} {statusIndicator.label}
                </Text>
              </Box>
            )}
            {pipeline && (
              <Box flexDirection="row" marginRight={2}>
                <Text color={pipeline.hasSource ? 'green' : 'gray'}>
                  Source {pipeline.hasSource ? '●' : '○'}
                </Text>
                <Box marginLeft={1}>
                  <Text color={pipeline.hasRefined ? 'green' : 'gray'}>
                    Refined {pipeline.hasRefined ? '●' : '○'}
                  </Text>
                </Box>
                <Box marginLeft={1}>
                  <Text color={pipeline.hasJobs ? 'green' : 'gray'}>
                    Jobs {pipeline.hasJobs ? '●' : '○'}
                  </Text>
                </Box>
                <Box marginLeft={1}>
                  <Text color={pipeline.hasPdf ? 'green' : 'gray'}>
                    PDF {pipeline.hasPdf ? '●' : '○'}
                  </Text>
                </Box>
              </Box>
            )}
            <Text dimColor>? help</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
