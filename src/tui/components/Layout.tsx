import type { ReactNode } from 'react';
import type { ScreenId } from '../types.ts';
import { NAV_LABELS } from '../types.ts';
import { DocumentShell } from './DocumentShell.tsx';

export interface LayoutProps {
  activeScreen: ScreenId;
  /** Second TopBar line (`Job: …`). */
  jobLine: string;
  statusLeft: string | null;
  statusLeftWarn?: boolean;
  statusRight: string;
  baselineHint: string;
  contextualHint: string;
  children: ReactNode;
}

export function Layout({
  activeScreen,
  jobLine,
  statusLeft,
  statusLeftWarn,
  statusRight,
  baselineHint,
  contextualHint,
  children,
}: LayoutProps) {
  return (
    <DocumentShell
      screenTitle={NAV_LABELS[activeScreen]}
      jobLine={jobLine}
      statusLeft={statusLeft}
      statusLeftWarn={statusLeftWarn}
      statusRight={statusRight}
      baselineHint={baselineHint}
      contextualHint={contextualHint}
    >
      {children}
    </DocumentShell>
  );
}
