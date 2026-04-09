import type { Profile, RefinementSession } from '../profile/schema.ts';
import {
  hashSource,
  jobRefinedJsonPath,
  jobRefinedMdPath,
  loadActiveProfile,
  loadJobRefinedProfile,
  loadRefinedIfExists,
  refinedJsonPath,
  refinedMdPath,
} from '../profile/serializer.ts';
import type { PersistenceTarget } from './activeDocumentSession.ts';

export function refinedJsonPathForTarget(profileDir: string, target: PersistenceTarget): string {
  return target.kind === 'global-refined'
    ? refinedJsonPath(profileDir)
    : jobRefinedJsonPath(profileDir, target.slug);
}

export function refinedMdPathForTarget(profileDir: string, target: PersistenceTarget): string {
  return target.kind === 'global-refined'
    ? refinedMdPath(profileDir)
    : jobRefinedMdPath(profileDir, target.slug);
}

export interface RefineTuiLoadedState {
  profile: Profile;
  session: RefinementSession;
}

/**
 * Loads the editable profile body and the refinement session Refine keeps in memory for the
 * active `persistenceTarget`.
 *
 * **Job target — profile:** `jobs/{slug}/refined.json` when present; otherwise `loadActiveProfile`
 * (global refined body if `refined.json` exists, else `source.json`).
 *
 * **Session (job vs global):** Per-job JSON stores profile only. When global `refined.json`
 * exists, reuse its `RefinedData.session` for Q&A and keep-session flows. Job saves still route
 * profile-only via `saveRefinedForPersistenceTarget`. If global refined is missing, return a
 * synthetic empty session tied to the current `source.json` hash so callers never need `loadRefined`
 * (which throws when `refined.json` is absent).
 */
export async function loadRefinedTuiState(
  profileDir: string,
  target: PersistenceTarget,
): Promise<RefineTuiLoadedState> {
  const globalData = await loadRefinedIfExists(profileDir);

  const session: RefinementSession =
    globalData?.session ??
    (await (async () => {
      const sourceHash = await hashSource(profileDir);
      return {
        conductedAt: new Date().toISOString(),
        sourceHash,
        questions: [],
        answers: {},
      };
    })());

  let profile: Profile;
  if (target.kind === 'job') {
    const jobProfile = await loadJobRefinedProfile(profileDir, target.slug);
    profile = jobProfile ?? (await loadActiveProfile(profileDir));
  } else {
    profile = globalData?.profile ?? (await loadActiveProfile(profileDir));
  }

  return { profile, session };
}
