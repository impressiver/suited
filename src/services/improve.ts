import type { Profile } from '../profile/schema.js';

export interface HealthScore {
  /** 0–5 inclusive. */
  score: number;
  contactOk: boolean;
  skillsOk: boolean;
  isRefined: boolean;
  hasSummary: boolean;
  positionsOk: boolean;
  skillCount: number;
  /** Positions that have content but no bullets (company labels for messaging). */
  noBulletCompanyNames: string[];
}

/**
 * Mirrors the scoring rules previously embedded in `commands/improve.ts` (`printHealthScore`).
 */
export function computeHealthScore(profile: Profile, isRefined: boolean): HealthScore {
  let score = 0;

  const contactFieldCount = [
    profile.contact.email,
    profile.contact.phone,
    profile.contact.linkedin,
  ].filter(Boolean).length;
  const contactOk = Boolean(profile.contact.name) && contactFieldCount >= 2;
  if (contactOk) score++;

  const skillsOk = profile.skills.length >= 10;
  if (skillsOk) score++;

  if (isRefined) score++;

  const hasSummary = Boolean(profile.summary?.value?.trim());
  if (hasSummary) score++;

  const contentPositions = profile.positions.filter(
    (p) => p.bullets.length > 0 || (p.description?.value ?? '').trim().length > 0,
  );
  const noBulletsPositions = contentPositions.filter((p) => p.bullets.length === 0);
  const positionsOk = noBulletsPositions.length === 0;
  if (positionsOk) score++;

  return {
    score,
    contactOk,
    skillsOk,
    isRefined,
    hasSummary,
    positionsOk,
    skillCount: profile.skills.length,
    noBulletCompanyNames: noBulletsPositions.map((p) => p.company.value),
  };
}
