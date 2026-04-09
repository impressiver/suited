import { createContext, type ReactNode, useContext } from 'react';
import type { PersistenceTarget } from '../activeDocumentSession.ts';

export interface ResumeEditorContextValue {
  mode: 'general' | 'job';
  /** Job description text -- only in job mode */
  jobDescription?: string;
  /** Job metadata -- only in job mode */
  jobTitle?: string;
  company?: string;
  jobId?: string;
  /** Where saves go */
  persistenceTarget: PersistenceTarget;
  /** Called when the user wants to leave the editor (Esc in nav mode) */
  onRequestClose: () => void;
}

const ResumeEditorContext = createContext<ResumeEditorContextValue | null>(null);

export function ResumeEditorProvider({
  value,
  children,
}: {
  value: ResumeEditorContextValue;
  children: ReactNode;
}) {
  return <ResumeEditorContext.Provider value={value}>{children}</ResumeEditorContext.Provider>;
}

export function useResumeEditorContext(): ResumeEditorContextValue {
  const ctx = useContext(ResumeEditorContext);
  if (!ctx) {
    throw new Error('useResumeEditorContext must be used within ResumeEditorProvider');
  }
  return ctx;
}
