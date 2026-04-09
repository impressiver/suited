import type { ProfileSnapshot } from './hooks/useProfileSnapshot.ts';

export type DashboardVariant = 'no-api-key' | 'no-source' | 'source-only' | 'refined' | 'ready';

/**
 * Maps snapshot + API presence to the five dashboard states from the spec.
 */
export function getDashboardVariant(
  snapshot: Pick<ProfileSnapshot, 'hasSource' | 'hasRefined' | 'jobsCount'>,
  hasApiKey: boolean,
): DashboardVariant {
  if (!hasApiKey) {
    return 'no-api-key';
  }
  if (!snapshot.hasSource) {
    return 'no-source';
  }
  if (!snapshot.hasRefined) {
    return 'source-only';
  }
  if (snapshot.jobsCount > 0) {
    return 'ready';
  }
  return 'refined';
}
