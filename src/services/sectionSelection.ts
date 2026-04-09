import type { ResumeDocument } from '../profile/schema.ts';

/**
 * Minimum number of experience rows to keep when the document has at least this many —
 * so a targeted JD doesn’t yield a one-job résumé. Indices `0 … min(this, n)−1` are always
 * included (and locked in the TUI). Same merge runs in CLI `generate`.
 */
export const MIN_VISIBLE_RESUME_POSITIONS = 3;

/** Ordered keys when every present section/position is included (matches CLI checkbox order). */
export function collectDefaultSectionKeys(doc: ResumeDocument): string[] {
  const keys: string[] = [];
  if (doc.summary) {
    keys.push('summary');
  }
  for (let i = 0; i < doc.positions.length; i++) {
    keys.push(`pos:${i}`);
  }
  if (doc.education.length) {
    keys.push('education');
  }
  if (doc.skills.length) {
    keys.push('skills');
  }
  if (doc.projects.length) {
    keys.push('projects');
  }
  if (doc.certifications.length) {
    keys.push('certifications');
  }
  if (doc.languages.length) {
    keys.push('languages');
  }
  if (doc.volunteer.length) {
    keys.push('volunteer');
  }
  if (doc.awards.length) {
    keys.push('awards');
  }
  return keys;
}

export interface SectionCheckboxItem {
  value: string;
  label: string;
  checked: boolean;
  /** First N experience rows — always included; Space does not turn off in `CheckboxList`. */
  locked?: boolean;
}

/** Plain labels for TUI checkboxes (CLI builds its own chalk-styled labels). */
export function buildSectionCheckboxItems(
  doc: ResumeDocument,
  savedSelection?: string[],
): SectionCheckboxItem[] {
  const savedSet = savedSelection != null ? new Set(savedSelection) : null;
  const items: SectionCheckboxItem[] = [];

  if (doc.summary) {
    items.push({
      value: 'summary',
      label: 'Summary',
      checked: savedSet ? savedSet.has('summary') : true,
    });
  }
  const positionFloor = Math.min(MIN_VISIBLE_RESUME_POSITIONS, doc.positions.length);
  for (let i = 0; i < doc.positions.length; i++) {
    const p = doc.positions[i];
    if (p) {
      const end = p.endDate ?? 'Present';
      const locked = i < positionFloor;
      const mustOn = locked;
      items.push({
        value: `pos:${i}`,
        label: `${p.title} @ ${p.company}  (${p.startDate} – ${end} · ${p.bullets.length} bullet${p.bullets.length === 1 ? '' : 's'})${locked ? ' · always in PDF' : ''}`,
        checked: mustOn || (savedSet ? savedSet.has(`pos:${i}`) : true),
        locked,
      });
    }
  }
  if (doc.education.length) {
    items.push({
      value: 'education',
      label: `Education (${doc.education.length})`,
      checked: savedSet ? savedSet.has('education') : true,
    });
  }
  if (doc.skills.length) {
    items.push({
      value: 'skills',
      label: `Skills (${doc.skills.length})`,
      checked: savedSet ? savedSet.has('skills') : true,
    });
  }
  if (doc.projects.length) {
    items.push({
      value: 'projects',
      label: `Projects (${doc.projects.length})`,
      checked: savedSet ? savedSet.has('projects') : true,
    });
  }
  if (doc.certifications.length) {
    items.push({
      value: 'certifications',
      label: `Certifications (${doc.certifications.length})`,
      checked: savedSet ? savedSet.has('certifications') : true,
    });
  }
  if (doc.languages.length) {
    items.push({
      value: 'languages',
      label: `Languages (${doc.languages.length})`,
      checked: savedSet ? savedSet.has('languages') : true,
    });
  }
  if (doc.volunteer.length) {
    items.push({
      value: 'volunteer',
      label: `Volunteer (${doc.volunteer.length})`,
      checked: savedSet ? savedSet.has('volunteer') : true,
    });
  }
  if (doc.awards.length) {
    items.push({
      value: 'awards',
      label: `Awards (${doc.awards.length})`,
      checked: savedSet ? savedSet.has('awards') : true,
    });
  }

  return items;
}

/**
 * Apply checkbox selection to a resume document.
 * - **Fullness floor:** the first `min(MIN_VISIBLE_RESUME_POSITIONS, n)` positions are always merged
 *   into the index set so the experience block stays substantive.
 * - **Gap-fill:** from index `0` through `max(selected ∪ floor)`, every role is kept so the timeline
 *   has no false holes — same as CLI.
 */
export function applyResumeSectionSelection(
  doc: ResumeDocument,
  selected: string[],
): { doc: ResumeDocument; gapReincludedCompanies: string[] } {
  const enabled = new Set(selected);

  const userPosIdxs = selected
    .filter((v) => v.startsWith('pos:'))
    .map((v) => parseInt(v.slice(4), 10))
    .filter((i) => !Number.isNaN(i) && i >= 0 && i < doc.positions.length);

  const n = doc.positions.length;
  const floorCount = Math.min(MIN_VISIBLE_RESUME_POSITIONS, n);
  const floorIdxs = Array.from({ length: floorCount }, (_, i) => i);

  const mergedForMax = new Set<number>([...userPosIdxs, ...floorIdxs]);
  const maxIdx = mergedForMax.size === 0 ? -1 : Math.max(...mergedForMax);

  const gapReincludedCompanies: string[] = [];
  const selectedPositions: ResumeDocument['positions'] = [];
  if (maxIdx >= 0) {
    const userPosSet = new Set(userPosIdxs);
    for (let i = 0; i <= maxIdx; i++) {
      const p = doc.positions[i];
      if (p && !userPosSet.has(i)) {
        gapReincludedCompanies.push(p.company);
      }
    }
    for (let i = 0; i <= maxIdx; i++) {
      const p = doc.positions[i];
      if (p) {
        selectedPositions.push(p);
      }
    }
  }

  return {
    doc: {
      ...doc,
      summary: enabled.has('summary') ? doc.summary : undefined,
      positions: selectedPositions,
      education: enabled.has('education') ? doc.education : [],
      skills: enabled.has('skills') ? doc.skills : [],
      projects: enabled.has('projects') ? doc.projects : [],
      certifications: enabled.has('certifications') ? doc.certifications : [],
      languages: enabled.has('languages') ? doc.languages : [],
      volunteer: enabled.has('volunteer') ? doc.volunteer : [],
      awards: enabled.has('awards') ? doc.awards : [],
    },
    gapReincludedCompanies,
  };
}

/**
 * All sections on (TUI/CLI default when not narrowing). Same doc shape as legacy `selectAllSections`.
 */
export function selectAllSections(doc: ResumeDocument): {
  doc: ResumeDocument;
  selected: string[];
} {
  const selected = collectDefaultSectionKeys(doc);
  const { doc: out } = applyResumeSectionSelection(doc, selected);
  return { doc: out, selected };
}
