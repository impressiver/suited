/**
 * Active document session — which resume file the TUI edits (see specs/tui-document-shell.md).
 * Wire into store + save dispatch in Phase D; pure types/helpers for now.
 */

export type PersistenceTarget =
  | { kind: 'global-refined' }
  | { kind: 'job'; jobId: string; slug: string };

export function globalRefinedTarget(): PersistenceTarget {
  return { kind: 'global-refined' };
}

export function jobRefinedTarget(jobId: string, slug: string): PersistenceTarget {
  return { kind: 'job', jobId, slug };
}

export function persistenceTargetsEqual(a: PersistenceTarget, b: PersistenceTarget): boolean {
  if (a.kind === 'global-refined' && b.kind === 'global-refined') {
    return true;
  }
  if (a.kind === 'job' && b.kind === 'job') {
    return a.jobId === b.jobId && a.slug === b.slug;
  }
  return false;
}

/** Stable string for logging, tests, and status crumbs (not a file path). */
export function persistenceTargetKey(t: PersistenceTarget): string {
  return t.kind === 'global-refined' ? 'global-refined' : `job:${t.slug}`;
}

export function isJobTarget(
  t: PersistenceTarget,
): t is Extract<PersistenceTarget, { kind: 'job' }> {
  return t.kind === 'job';
}

/** TopBar second line (`Job: —` vs job slug). */
export function formatTopBarJobLine(target: PersistenceTarget): string {
  return target.kind === 'global-refined' ? 'Job: —' : `Job: ${target.slug}`;
}
