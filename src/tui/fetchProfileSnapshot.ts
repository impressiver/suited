import { getFlairInfo } from '../generate/resume-builder.ts';
import {
  loadGenerationConfig,
  loadJobs,
  loadSource,
  refinedJsonPath,
  sourceJsonPath,
} from '../profile/serializer.ts';
import { fileExists } from '../utils/fs.ts';
import type { ProfileSnapshot } from './hooks/useProfileSnapshot.ts';

/**
 * Loads dashboard snapshot from disk (same logic as {@link useProfileSnapshot}).
 * Used by tests and the hook; keep in sync when adding fields.
 */
export async function fetchProfileSnapshot(profileDir: string): Promise<ProfileSnapshot> {
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

  return {
    loading: false,
    error: null,
    hasSource,
    hasRefined,
    name,
    positionCount,
    skillCount,
    jobsCount: jobs.length,
    lastPdfLine,
  };
}
