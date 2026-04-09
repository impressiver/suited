import { Box, Text } from 'ink';
import type { ScreenId } from '../types.ts';
import { NAV_LABELS } from '../types.ts';

export interface TitleBarProps {
  /** Current screen identifier */
  activeScreen: ScreenId;
  /** Job context line (e.g., "Job: —" or "Job: acme · Staff Eng") */
  jobLine: string;
  /** Optional context info (e.g., operation status, section name) */
  contextInfo?: string | null;
  /** Available width for layout calculations */
  width: number;
}

/**
 * ANSI box-drawing logo for "Suited".
 * Two-tone color scheme: cyan for top/primary, blue for bottom/shadow.
 */
const SUITED_LOGO_LINES = ['┏━┓╻ ╻╻╺┳╸┏━╸╺┳┓', '┗━┓┃ ┃┃ ┃ ┣╸  ┃┃', '┗━┛┗━┛╹ ╹ ┗━╸╺┻┛'];

/**
 * Clean title bar with fancy ANSI block logo on left, screen/job/context on right.
 * Style inspired by OpenCode - simple, elegant, minimal.
 */
export function TitleBar({ activeScreen, jobLine, contextInfo, width }: TitleBarProps) {
  const screenName = NAV_LABELS[activeScreen];

  // Build the right-side content: Screen · Job · Context
  const parts: string[] = [screenName];

  // Add job info if present (strip "Job: " prefix for cleaner look)
  const jobPart = jobLine.replace(/^Job: /, '');
  if (jobPart && jobPart !== '—') {
    parts.push(jobPart);
  }

  // Add context info if present
  if (contextInfo && contextInfo !== '') {
    parts.push(contextInfo);
  }

  const rightContent = parts.join(' · ');

  // Logo is fixed width (16 chars), right side gets remaining space
  const logoWidth = SUITED_LOGO_LINES[0]?.length || 16;
  const rightAvailableWidth = Math.max(10, width - logoWidth - 2);

  return (
    <Box flexDirection="row" justifyContent="space-between" width={width}>
      {/* Logo on the left - always show full logo with two-tone colors */}
      <Box flexDirection="column" marginRight={1} minWidth={logoWidth}>
        {SUITED_LOGO_LINES.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static logo lines
          <Box key={i}>
            <Text color={i === 0 ? 'cyan' : 'blue'} bold={i === 0} dimColor={i > 1}>
              {line}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Screen info on the right, vertically centered */}
      <Box width={rightAvailableWidth} justifyContent="flex-end" alignItems="center">
        <Text wrap="truncate-end" dimColor>
          {rightContent}
        </Text>
      </Box>
    </Box>
  );
}
