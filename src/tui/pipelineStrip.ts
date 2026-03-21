import type { ProfileSnapshot } from './hooks/useProfileSnapshot.ts';

function dot(done: boolean): string {
  return done ? '●' : '○';
}

/**
 * Compact pipeline line for the shell header (same semantics as Dashboard "Pipeline").
 */
export function formatPipelineStrip(
  snapshot: Pick<ProfileSnapshot, 'hasSource' | 'hasRefined' | 'jobsCount' | 'lastPdfLine'>,
): string {
  return [
    `Source ${dot(snapshot.hasSource)}`,
    `Refined ${dot(snapshot.hasRefined)}`,
    `Jobs ${dot(snapshot.jobsCount > 0)}`,
    `Last PDF ${dot(Boolean(snapshot.lastPdfLine))}`,
  ].join(' · ');
}
