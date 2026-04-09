import { Box, Text } from 'ink';

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface StatusBarNotificationsProps {
  /** Current notification(s) to display */
  notifications: Notification[];
  /** Available width */
  width: number;
}

/**
 * Status bar notification display with text wrapping.
 * Long messages wrap to a second line (max 2 lines total).
 * ASCII icon indicates notification type.
 */
export function StatusBarNotifications({ notifications, width }: StatusBarNotificationsProps) {
  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'error':
        return '✗';
      case 'warn':
        return '!';
      case 'success':
        return '✓';
      case 'info':
      default:
        return 'ℹ';
    }
  };

  const getColor = (type: Notification['type']) => {
    switch (type) {
      case 'error':
        return 'red';
      case 'warn':
        return 'yellow';
      case 'success':
        return 'green';
      case 'info':
      default:
        return undefined;
    }
  };

  // Take the first notification and display it (with wrapping)
  const notification = notifications[0];

  if (!notification) {
    return (
      <Box flexDirection="column" height={2}>
        <Text> </Text>
        <Text> </Text>
      </Box>
    );
  }

  const icon = getIcon(notification.type);
  const color = getColor(notification.type);
  const fullText = `${icon} ${notification.message}`;

  // Simple word wrap to max 2 lines
  const words = fullText.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).length <= width) {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    } else {
      if (currentLine) lines.push(currentLine);
      if (lines.length < 2) {
        currentLine = word;
      }
    }
  }
  if (currentLine && lines.length < 2) {
    lines.push(currentLine);
  }

  // Pad to exactly 2 lines
  while (lines.length < 2) {
    lines.push('');
  }

  return (
    <Box flexDirection="column" height={2}>
      {lines.slice(0, 2).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: only 2 static lines
        <Text key={`line-${i}`} color={color} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}
