import type { CuratorResult } from '../generate/curator.ts';
import { curateForJob } from '../generate/curator.ts';
import { analyzeJobDescription } from '../generate/job-analyzer.ts';
import type { JobRefinement, PinnedJobRender } from '../profile/schema.ts';
import { loadActiveProfile, loadJobRefinement, saveJobRefinement } from '../profile/serializer.ts';

export interface JobRefinementJobSlice {
  id: string;
  company: string;
  title: string;
  text: string;
}

/**
 * Analyze JD (or reuse stored analysis), curate profile, persist {@link JobRefinement}.
 * No console output — for TUI and for CLI wrappers that add their own spinners.
 */
export async function runJobRefinementPipeline(
  profileDir: string,
  job: JobRefinementJobSlice,
  existingRefinement: JobRefinement | null,
): Promise<JobRefinement> {
  const profile = await loadActiveProfile(profileDir);

  let jobAnalysis = existingRefinement?.jobAnalysis ?? null;

  if (!jobAnalysis) {
    try {
      jobAnalysis = await analyzeJobDescription(job.text);
    } catch {
      jobAnalysis = {
        company: job.company,
        title: job.title,
        industry: 'general',
        seniority: 'mid',
        keySkills: [],
        mustHaves: [],
        niceToHaves: [],
        summary: job.text.slice(0, 200),
      };
    }
  }

  let curatorResult: CuratorResult;
  try {
    curatorResult = await curateForJob(profile, jobAnalysis);
  } catch (err) {
    throw new Error(`Curation failed: ${(err as Error).message}`);
  }

  const newRefinement: JobRefinement = {
    jobId: job.id,
    createdAt: new Date().toISOString(),
    jobAnalysis,
    plan: curatorResult.plan,
    ...(existingRefinement?.pinnedRender != null
      ? { pinnedRender: existingRefinement.pinnedRender }
      : {}),
  };

  await saveJobRefinement(newRefinement, profileDir);
  return newRefinement;
}

/** Writes `pinnedRender` into the existing refinement file for `jobId`, if present. */
export async function persistJobRefinementPinnedRender(
  profileDir: string,
  jobId: string,
  pin: PinnedJobRender,
): Promise<void> {
  const existing = await loadJobRefinement(profileDir, jobId);
  if (!existing) return;
  await saveJobRefinement({ ...existing, pinnedRender: pin }, profileDir);
}
