import { Sourced, DataSource } from '../profile/schema.js';

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Normalize dates to YYYY-MM or YYYY. Returns original string if unrecognizable.
 * Handles: "YYYY-MM", "YYYY", "Month YYYY", "YYYY Month", "MM/YYYY", "Mon YYYY",
 * "Month, YYYY", "Present", and two-digit month numbers.
 */
export function normalizeDate(raw: string): string {
  if (!raw) return raw;
  const s = raw.trim();
  if (!s || s.toLowerCase() === 'present') return s;

  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // Already YYYY
  if (/^\d{4}$/.test(s)) return s;

  // MM/YYYY or M/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[2]}-${slashMatch[1].padStart(2, '0')}`;

  // Split on spaces, commas, hyphens, slashes
  const parts = s.split(/[\s,/]+/).filter(p => p.length > 0);
  let year: string | undefined;
  let month: string | undefined;

  for (const part of parts) {
    if (/^\d{4}$/.test(part)) { year = part; continue; }
    const m = MONTH_MAP[part.toLowerCase()];
    if (m) { month = m; continue; }
    // Numeric month 1-12
    if (/^\d{1,2}$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= 12) { month = String(n).padStart(2, '0'); }
    }
  }

  if (year && month) return `${year}-${month}`;
  if (year) return year;
  return s;
}

// ---------------------------------------------------------------------------
// Bullet splitting
// ---------------------------------------------------------------------------

/**
 * Split a multi-line description into individual bullets.
 * Handles: newline-separated, bullet char (•, –, —, *, -) prefixed lines.
 * Single-line descriptions with no bullet markers are returned as-is.
 */
export function splitBullets<S extends DataSource>(raw: Sourced<string>): Sourced<string>[] {
  const text = raw.value;
  if (!text || !text.trim()) return [];

  const trimmed = text.trim();

  // Split on newlines
  const lines = trimmed
    .split(/\n/)
    .map(l => l.replace(/^[\s•\-*–—▪▸]+/, '').trim())
    .filter(l => l.length > 2); // discard very short fragments

  if (lines.length > 1) {
    return lines.map(l => ({ value: l, source: raw.source }));
  }

  // Single-line: return as-is (don't split on semicolons — too ambiguous)
  return [{ value: trimmed, source: raw.source }];
}

// ---------------------------------------------------------------------------
// Skill deduplication
// ---------------------------------------------------------------------------

export function deduplicateSkills<T extends { name: Sourced<string> }>(skills: T[]): T[] {
  const seen = new Set<string>();
  return skills.filter(s => {
    const key = s.name.value.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
