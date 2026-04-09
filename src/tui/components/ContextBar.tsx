import { Box, Text } from 'ink';
import type { ScreenId } from '../types.ts';
import { NAV_LABELS } from '../types.ts';

export interface ContextBarProps {
  /** Current screen identifier */
  activeScreen: ScreenId;
  /** Current job/persistence target context (e.g., "Engineering Manager @ Company") */
  contextTarget?: string | null;
  /** Currently selected section in the editor (e.g., "Experience > Full Stack Engineer @ Fireworks.ai") */
  selectedSection?: string | null;
  /** Available width */
  width: number;
}

/**
 * Context bar shown immediately below the header.
 * Displays: Screen :: Context :: Selected Section
 *
 * Examples:
 * - Refine: Resume :: Experience > Full Stack Engineer @ Fireworks.ai
 * - Refine: Jobs / Engineering Manager @ Arize AI :: Experience > Full Stack Engineer @ Fireworks.ai
 * - Jobs: Add/update job descriptions for targeted resumes
 * - Jobs: Engineering Manager - Product & Platform @ Arize AI
 * - Profile: Contact information and social links
 */
export function ContextBar({
  activeScreen,
  contextTarget,
  selectedSection,
  width,
}: ContextBarProps) {
  const screenLabel = NAV_LABELS[activeScreen];

  // Build the context line
  const parts: string[] = [];

  // Screen part (bold, colored based on screen)
  const screenColor = getScreenColor(activeScreen);

  // Context target part (if present)
  if (contextTarget && contextTarget !== '') {
    parts.push(contextTarget);
  }

  // Selected section part (if editing)
  if (selectedSection && selectedSection !== '') {
    parts.push(selectedSection);
  }

  const contextString = parts.join(' :: ');

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Text bold color={screenColor}>
        {screenLabel}
      </Text>
      {contextString && (
        <Text>
          <Text dimColor>: </Text>
          <Text wrap="truncate-end" dimColor={!selectedSection}>
            {contextString}
          </Text>
        </Text>
      )}
    </Box>
  );
}

function getScreenColor(screen: ScreenId): string {
  switch (screen) {
    case 'dashboard':
      return 'cyan';
    case 'jobs':
      return 'green';
    case 'generate':
      return 'yellow';
    case 'profile':
      return 'magenta';
    case 'contact':
      return 'cyan';
    case 'import':
      return 'blue';
    case 'settings':
      return 'gray';
    default:
      return 'white';
  }
}
