/**
 * Pure resume section index for the document viewport: maps `Profile` structure to
 * markdown `##` headings and wrapped scroll offsets. Aligns labels with
 * `REFINE_SECTION_MENU_ROWS` / `consultantEvaluateLabel` for summary, experience, skills.
 */
import { profileMarkdownContent } from '../profile/markdown.ts';
import type { Profile } from '../profile/schema.ts';
import { splitLinesForWrap, wrapLineToRows } from './utils/wrapTextRows.ts';

export type ResumeSectionId = 'summary' | 'experience' | 'skills' | 'education';

export interface ResumeSectionEntry {
  id: ResumeSectionId;
  /** Matches `##` heading text in `profileMarkdownContent` (trimmed). */
  label: string;
  /** Same as Refine section consultant labels for summary / experience / skills. */
  polishLabel: string;
}

/** Section ids that map to Refine polish + section consultant flows. */
export type RefinableResumeSectionId = Exclude<ResumeSectionId, 'education'>;

export function isRefinableSectionId(id: ResumeSectionId): id is RefinableResumeSectionId {
  return id === 'summary' || id === 'experience' || id === 'skills';
}

export function profileMarkdownLines(profile: Profile): string[] {
  return splitLinesForWrap(profileMarkdownContent(profile));
}

/**
 * Sections that exist in the profile markdown (same presence rules as emitted `##` blocks).
 */
export function buildResumeSectionIndex(profile: Profile): ResumeSectionEntry[] {
  const out: ResumeSectionEntry[] = [];
  if (profile.summary) {
    out.push({ id: 'summary', label: 'Summary', polishLabel: 'Summary' });
  }
  if (profile.positions.length > 0) {
    out.push({ id: 'experience', label: 'Experience', polishLabel: 'Experience' });
  }
  if (profile.skills.length > 0) {
    out.push({ id: 'skills', label: 'Skills', polishLabel: 'Skills' });
  }
  if (profile.education.length > 0) {
    out.push({ id: 'education', label: 'Education', polishLabel: 'Education' });
  }
  return out;
}

/**
 * First wrapped display row index for the start of logical line `logicalLine` (0-based).
 */
export function firstWrappedRowForLogicalLine(
  rawMarkdownLines: string[],
  logicalLine: number,
  textW: number,
): number {
  let offset = 0;
  const n = Math.min(logicalLine, rawMarkdownLines.length);
  for (let i = 0; i < n; i++) {
    const raw = rawMarkdownLines[i];
    if (raw === undefined) {
      break;
    }
    offset += wrapLineToRows(raw, textW).length;
  }
  return offset;
}

/**
 * Scan logical lines for a top-level `##` heading whose title matches the section (trim, case-fold).
 */
export function findDisplayRowForSection(
  rawMarkdownLines: string[],
  entry: ResumeSectionEntry,
): number | null {
  const target = entry.label.trim().toLowerCase();
  for (let i = 0; i < rawMarkdownLines.length; i++) {
    const raw = rawMarkdownLines[i];
    if (raw === undefined) {
      continue;
    }
    const line = raw.replace(/\r/g, '');
    const m = line.match(/^##\s+(.+)$/);
    if (!m) {
      continue;
    }
    const cap = m[1];
    if (cap === undefined) {
      continue;
    }
    const title = cap.trim().toLowerCase();
    if (title === target) {
      return i;
    }
  }
  return null;
}

/**
 * Which resume section (by `##` heading) contains the given character offset in markdown.
 */
const POS_ID_HTML_COMMENT = /<!--\s*pos-id:([^>\s]+)\s*-->/;

function parseExperienceHeadingForIndex(line: string): { title: string; company: string } | null {
  const t = line.trim().replace(/^###\s+/, '');
  const at = t.lastIndexOf(' at ');
  if (at === -1) {
    return null;
  }
  const title = t.slice(0, at).trim();
  const company = t.slice(at + 4).trim();
  if (!title || !company) {
    return null;
  }
  return { title, company };
}

/**
 * When the caret is under `## Experience`, the nearest preceding `<!-- pos-id:... -->`
 * marker (per `profileMarkdownContent`) identifies the active role block.
 */
export function resumeExperiencePositionIdAtMarkdownOffset(
  md: string,
  offset: number,
  entries: ResumeSectionEntry[],
): string | null {
  if (resumeSectionIdAtMarkdownOffset(md, offset, entries) !== 'experience') {
    return null;
  }
  const safe = Math.max(0, Math.min(offset, md.length));
  const head = md.slice(0, safe);
  const lineIdx = head === '' ? 0 : (head.match(/\n/g)?.length ?? 0);
  const lines = md.split('\n');
  for (let i = lineIdx; i >= 0; i--) {
    const row = lines[i] ?? '';
    const m = POS_ID_HTML_COMMENT.exec(row);
    if (m?.[1]) {
      return m[1].trim();
    }
  }
  return null;
}

/**
 * Same as {@link resumeExperiencePositionIdAtMarkdownOffset} for **display** markdown
 * (HTML comments stripped): uses `### Title at Company` blocks in order under `## Experience`.
 */
export function resumeExperiencePositionIdForEditorView(
  md: string,
  offset: number,
  profile: Profile,
  entries: ResumeSectionEntry[],
): string | null {
  if (resumeSectionIdAtMarkdownOffset(md, offset, entries) !== 'experience') {
    return null;
  }
  const lines = md.split('\n');
  const safe = Math.max(0, Math.min(offset, md.length));
  const lineIdx = safe === 0 ? 0 : (md.slice(0, safe).match(/\n/g)?.length ?? 0);

  let inExp = false;
  const blockStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const row = (lines[i] ?? '').trim();
    if (/^##\s+Experience/i.test(row)) {
      inExp = true;
      blockStarts.length = 0;
      continue;
    }
    if (inExp && /^##\s+/.test(row)) {
      break;
    }
    if (inExp && /^###\s+/.test(row)) {
      blockStarts.push(i);
    }
  }
  if (!inExp || blockStarts.length === 0) {
    return null;
  }
  let blockIndex = -1;
  for (let j = 0; j < blockStarts.length; j++) {
    const start = blockStarts[j];
    if (start !== undefined && start <= lineIdx) {
      blockIndex = j;
    } else {
      break;
    }
  }
  if (blockIndex < 0) {
    return null;
  }
  const headingLine = (lines[blockStarts[blockIndex] ?? -1] ?? '').trim();
  const ph = parseExperienceHeadingForIndex(headingLine);
  if (ph) {
    const pos = profile.positions.find(
      (p) => p.title.value === ph.title && p.company.value === ph.company,
    );
    if (pos) {
      return pos.id;
    }
  }
  return profile.positions[blockIndex]?.id ?? null;
}

/** Short UI label for the section strip (dashboard editor). */
export function experiencePositionShortLabel(profile: Profile, positionId: string): string | null {
  const pos = profile.positions.find((p) => p.id === positionId);
  if (pos == null) {
    return null;
  }
  return `${pos.title.value} @ ${pos.company.value}`;
}

export function resumeSectionIdAtMarkdownOffset(
  md: string,
  offset: number,
  entries: ResumeSectionEntry[],
): ResumeSectionId | null {
  const safe = Math.max(0, Math.min(offset, md.length));
  const head = md.slice(0, safe);
  const lineIdx = head === '' ? 0 : (head.match(/\n/g)?.length ?? 0);
  const lines = md.split('\n');
  for (let i = lineIdx; i >= 0; i--) {
    const row = lines[i] ?? '';
    const e = matchSectionEntryForHeadingLine(row, entries);
    if (e != null) {
      return e.id;
    }
  }
  return null;
}

export function matchSectionEntryForHeadingLine(
  headingLine: string,
  entries: ResumeSectionEntry[],
): ResumeSectionEntry | null {
  const t = headingLine.trimStart();
  const m = t.match(/^##\s+(.+)$/);
  if (!m) {
    return null;
  }
  const cap = m[1];
  if (cap === undefined) {
    return null;
  }
  const title = cap.trim().toLowerCase();
  for (const e of entries) {
    if (e.label.trim().toLowerCase() === title || e.polishLabel.trim().toLowerCase() === title) {
      return e;
    }
  }
  return null;
}

/** Wrapped scroll offset (first row of section) per section id; omit if heading missing. */
export function buildSectionScrollRowMap(
  profile: Profile,
  textW: number,
): Map<ResumeSectionId, number> {
  const lines = profileMarkdownLines(profile);
  const entries = buildResumeSectionIndex(profile);
  const map = new Map<ResumeSectionId, number>();
  for (const e of entries) {
    const logical = findDisplayRowForSection(lines, e);
    if (logical == null) {
      continue;
    }
    map.set(e.id, firstWrappedRowForLogicalLine(lines, logical, textW));
  }
  return map;
}
