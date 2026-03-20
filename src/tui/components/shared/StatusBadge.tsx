import { Text } from 'ink';
import type { ReactNode } from 'react';

export type StatusTone = 'ok' | 'warn' | 'error' | 'muted' | 'info';

const toneProps: Record<StatusTone, { color?: string; dimColor?: boolean; bold?: boolean }> = {
  ok: { color: 'green' },
  warn: { color: 'yellow' },
  error: { color: 'red' },
  muted: { dimColor: true },
  info: { color: 'cyan' },
};

export interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <Text {...toneProps[tone]}>{children}</Text>;
}
