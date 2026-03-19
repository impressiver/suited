/**
 * Accuracy Guard — validates that every reference in a CurationPlan
 * maps to real data in the profile, with type checking.
 *
 * - Bullet refs must be `b:{positionId}:{index}` and belong to the claimed position
 * - Summary ref must be `"summary"` if the profile has a summary
 * - Skill/edu/project/cert IDs must exist in the profile
 *
 * Throws AccuracyGuardError on any mismatch. Pipeline halts before assembly.
 */

import type { CurationPlan, Profile } from '../profile/schema.js';
import type { RefEntry } from './prompts/curate.js';

export interface AccuracyError {
  ref: string;
  reason: string;
}

export class AccuracyGuardError extends Error {
  constructor(public readonly errors: AccuracyError[]) {
    super(
      `Accuracy guard failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  - [${e.ref}]: ${e.reason}`).join('\n'),
    );
    this.name = 'AccuracyGuardError';
  }
}

/**
 * Resolve a dot-path like "positions[2].bullets[0].value" against a profile.
 */
export function resolvePath(profile: Profile, path: string): string | undefined {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = profile;
  for (const seg of segments) {
    if (current == null) return undefined;
    current = current[seg];
  }
  return typeof current === 'string' ? current : undefined;
}

export function validateCurationPlan(
  plan: CurationPlan,
  profile: Profile,
  refMap: Map<string, RefEntry>,
): { errors: AccuracyError[] } {
  const errors: AccuracyError[] = [];

  // -------------------------------------------------------------------------
  // Position bullet refs
  // -------------------------------------------------------------------------
  for (const selPos of plan.selectedPositions) {
    // Verify the position ID exists in profile
    const posIdx = profile.positions.findIndex((p) => p.id === selPos.positionId);
    if (posIdx === -1) {
      errors.push({
        ref: selPos.positionId,
        reason: `Position "${selPos.positionId}" not found in profile`,
      });
      continue;
    }
    const _pos = profile.positions[posIdx];

    for (const bulletRef of selPos.bulletRefs) {
      const entry = refMap.get(bulletRef);
      if (!entry) {
        errors.push({ ref: bulletRef, reason: `Bullet ref "${bulletRef}" not found in ref list` });
        continue;
      }

      // Type check: must be a bullet
      if (entry.kind !== 'bullet') {
        errors.push({
          ref: bulletRef,
          reason: `Ref "${bulletRef}" has kind "${entry.kind}", expected "bullet"`,
        });
        continue;
      }

      // Boundary check: bullet must belong to THIS position
      if (entry.positionId !== selPos.positionId) {
        errors.push({
          ref: bulletRef,
          reason: `Bullet "${bulletRef}" belongs to position "${entry.positionId}", not "${selPos.positionId}" — bullets cannot be moved between positions`,
        });
        continue;
      }

      // Value integrity: resolved path must match stored value
      const resolved = resolvePath(profile, entry.path);
      if (resolved === undefined) {
        errors.push({ ref: bulletRef, reason: `Path "${entry.path}" does not resolve in profile` });
        continue;
      }
      if (resolved !== entry.value) {
        errors.push({
          ref: bulletRef,
          reason: `Value mismatch at "${entry.path}": stored "${entry.value}" but profile has "${resolved}"`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Summary ref
  // -------------------------------------------------------------------------
  if (plan.summaryRef !== null) {
    if (plan.summaryRef !== 'summary') {
      errors.push({
        ref: plan.summaryRef,
        reason: `summaryRef must be "summary" or null, got "${plan.summaryRef}"`,
      });
    } else if (!profile.summary) {
      errors.push({ ref: 'summary', reason: 'summaryRef is "summary" but profile has no summary' });
    } else {
      const entry = refMap.get('summary');
      if (entry) {
        const resolved = resolvePath(profile, entry.path);
        if (resolved !== undefined && resolved !== entry.value) {
          errors.push({
            ref: 'summary',
            reason: `Summary value mismatch: stored "${entry.value}" but profile has "${resolved}"`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Skill IDs
  // -------------------------------------------------------------------------
  for (const skillId of plan.selectedSkillIds) {
    if (!profile.skills.some((s) => s.id === skillId)) {
      errors.push({ ref: skillId, reason: `Skill ID "${skillId}" not found in profile` });
    }
  }

  // -------------------------------------------------------------------------
  // Project IDs
  // -------------------------------------------------------------------------
  for (const projId of plan.selectedProjectIds) {
    if (!profile.projects.some((p) => p.id === projId)) {
      errors.push({ ref: projId, reason: `Project ID "${projId}" not found in profile` });
    }
  }

  // -------------------------------------------------------------------------
  // Education IDs
  // -------------------------------------------------------------------------
  for (const eduId of plan.selectedEducationIds) {
    if (!profile.education.some((e) => e.id === eduId)) {
      errors.push({ ref: eduId, reason: `Education ID "${eduId}" not found in profile` });
    }
  }

  // -------------------------------------------------------------------------
  // Certification IDs
  // -------------------------------------------------------------------------
  for (const certId of plan.selectedCertificationIds) {
    if (!profile.certifications.some((c) => c.id === certId)) {
      errors.push({ ref: certId, reason: `Certification ID "${certId}" not found in profile` });
    }
  }

  return { errors };
}

export function assertAccurate(
  plan: CurationPlan,
  profile: Profile,
  refMap: Map<string, RefEntry>,
): void {
  const { errors } = validateCurationPlan(plan, profile, refMap);
  if (errors.length > 0) {
    throw new AccuracyGuardError(errors);
  }
}
