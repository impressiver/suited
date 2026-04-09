import type { ProfileSnapshot } from './hooks/useProfileSnapshot.ts';

export interface FormatPipelineStripOptions {
  /** When true, use `[x]` / `[ ]` instead of filled/empty dots (see specs/tui-terminal.md, indicator matrix). */
  noColor?: boolean;
}

function pipelineFlag(done: boolean, noColor: boolean): string {
  if (noColor) {
    return done ? '[x]' : '[ ]';
  }
  return done ? '●' : '○';
}

/**
 * Compact pipeline line for the shell header (same semantics as Dashboard "Pipeline").
 */
export function formatPipelineStrip(
  snapshot: Pick<ProfileSnapshot, 'hasSource' | 'hasRefined' | 'jobsCount' | 'lastPdfLine'>,
  options?: FormatPipelineStripOptions,
): string {
  const noColor = options?.noColor === true;
  const flag = (done: boolean) => pipelineFlag(done, noColor);
  return [
    `Source ${flag(snapshot.hasSource)}`,
    `Refined ${flag(snapshot.hasRefined)}`,
    `Jobs ${flag(snapshot.jobsCount > 0)}`,
    `Last PDF ${flag(Boolean(snapshot.lastPdfLine))}`,
  ].join(' · ');
}
