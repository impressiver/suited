import { useEffect } from 'react';
import { useNotifications } from '../notificationContext.tsx';

export interface EditorHintProps {
  /** Whether the editor is currently focused */
  isFocused: boolean;
  /** The current section label to display */
  sectionLabel: string;
}

/**
 * Shows a notification in the status bar when entering the text editor
 * with keyboard commands. Auto-dismisses after a few seconds.
 */
export function EditorHint({ isFocused, sectionLabel }: EditorHintProps) {
  const { addNotification, removeNotification } = useNotifications();

  useEffect(() => {
    if (isFocused) {
      addNotification({
        message: `Editing: ${sectionLabel} | Esc: nav | Ctrl+S: save | Ctrl+P: polish | Ctrl+E: consultant`,
        type: 'info',
      });
      // Auto-remove after 5 seconds
      const timer = setTimeout(() => {
        // Note: The notification system auto-generates IDs
        // For now we rely on the notification expiring naturally or being replaced
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isFocused, sectionLabel, addNotification]);

  return null;
}
