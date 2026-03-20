import { buildRefList } from '../claude/prompts/curate.js';
import type { Profile } from '../profile/schema.js';

export interface ValidationResult {
  /** True when structure + ref map are usable for accuracy guard (matches prior CLI messaging). */
  ok: true;
  referenceCount: number;
  /** Same map used for reference count — for CLI listing of sample refs. */
  refMap: ReturnType<typeof buildRefList>['refMap'];
}

export function validateProfile(profile: Profile): ValidationResult {
  const { refMap } = buildRefList(profile);
  return { ok: true, referenceCount: refMap.size, refMap };
}
