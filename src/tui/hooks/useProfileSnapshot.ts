import { useCallback, useEffect, useState } from 'react';
import { getFlairInfo } from '../../generate/resume-builder.js';
import {
  loadGenerationConfig,
  loadJobs,
  loadSource,
  refinedJsonPath,
  sourceJsonPath,
} from '../../profile/serializer.js';
import { fileExists } from '../../utils/fs.js';

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
      const hasSource = await fileExists(sourceJsonPath(profileDir));
      const hasRefined = await fileExists(refinedJsonPath(profileDir));
      let name: string | null = null;
      let positionCount = 0;
      let skillCount = 0;
      let lastPdfLine: string | null = null;

      if (hasSource) {
        const source = await loadSource(profileDir);
        name = source.contact.name.value;
        positionCount = source.positions.length;
        skillCount = source.skills.length;
      }

      const config = await loadGenerationConfig(profileDir);
      if (config && (config.company || config.jobTitle)) {
        const target = config.company ? `${config.company} – ${config.jobTitle}` : config.jobTitle;
        const date = new Date(config.updatedAt).toLocaleDateString();
        let template = config.resolvedTemplate ?? config.templateOverride;
        if (!template) {
          const { effectiveTemplate } = getFlairInfo(
            config.flair,
            config.jobAnalysis?.industry ?? 'general',
          );
          template = effectiveTemplate;
        }
        lastPdfLine = `${target} (${date}, ${template})`;
      }

      const jobs = await loadJobs(profileDir);

      setState({
        loading: false,
        error: null,
        hasSource,
        hasRefined,
        name,
        positionCount,
        skillCount,
        jobsCount: jobs.length,
        lastPdfLine,
      });
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
