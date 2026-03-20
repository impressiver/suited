import { useCallback, useEffect, useState } from 'react';
import { fetchProfileSnapshot } from '../fetchProfileSnapshot.ts';

export interface ProfileSnapshot {
  loading: boolean;
  error: string | null;
  hasSource: boolean;
  hasRefined: boolean;
  name: string | null;
  positionCount: number;
  skillCount: number;
  jobsCount: number;
  lastPdfLine: string | null;
}

export function useProfileSnapshot(profileDir: string): ProfileSnapshot & { refresh: () => void } {
  const [state, setState] = useState<ProfileSnapshot>({
    loading: true,
    error: null,
    hasSource: false,
    hasRefined: false,
    name: null,
    positionCount: 0,
    skillCount: 0,
    jobsCount: 0,
    lastPdfLine: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const next = await fetchProfileSnapshot(profileDir);
      setState(next);
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: (err as Error).message,
      }));
    }
  }, [profileDir]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refresh: load };
}
