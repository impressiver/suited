import { createContext, useContext, useState } from 'react';

export interface StatusBarNotification {
  id: string;
  message: string;
  type: 'info' | 'warn' | 'error';
  timestamp: number;
}

interface NotificationContextValue {
  notifications: StatusBarNotification[];
  addNotification: (notification: Omit<StatusBarNotification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    return {
      notifications: [],
      addNotification: () => {},
      removeNotification: () => {},
      clearNotifications: () => {},
    };
  }
  return ctx;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<StatusBarNotification[]>([]);

  const addNotification = (notification: Omit<StatusBarNotification, 'id' | 'timestamp'>) => {
    const newNotification: StatusBarNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    };
    setNotifications((prev) => [...prev, newNotification].slice(-3)); // Keep only last 3
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  return (
    <NotificationContext.Provider
      value={{ notifications, addNotification, removeNotification, clearNotifications }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
