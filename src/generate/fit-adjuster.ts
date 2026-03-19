/**
 * Generates CSS overrides to squeeze resume content onto one page
 * without removing any content. Tries progressively tighter values.
 *
 * Level 1 — spacing only (handles ~2-8% overflow)
 * Level 2 — spacing + moderate font shrink (handles ~8-16% overflow)
 * Level 3 — maximum squeeze (handles ~16-25% overflow)
 *
 * Uses !important to override template values without modifying template CSS.
 */

export type SqueezeLevel = 1 | 2 | 3;

// Thresholds: if overflow ratio exceeds these, try the next level
export const SQUEEZE_THRESHOLDS: Record<SqueezeLevel, number> = {
  1: 1.02, // apply level 1 if overflow > 2%
  2: 1.09, // escalate to level 2 if still overflowing after level 1
  3: 1.16, // escalate to level 3 if still overflowing after level 2
};

// If overflow exceeds this after level 3, we can't fix it with CSS alone
export const SQUEEZE_GIVES_UP_AT = 1.28;

export function buildFitOverrideCss(level: SqueezeLevel): string {
  const base = `
/* ── Fit override level ${level} ── */
body {
  line-height: ${level === 1 ? 1.38 : level === 2 ? 1.3 : 1.22} !important;
}

/* Header — biggest single contributor to height */
.resume-header {
  padding-top:    ${level === 1 ? 11 : level === 2 ? 8 : 6}pt !important;
  padding-bottom: ${level === 1 ? 11 : level === 2 ? 8 : 6}pt !important;
}
.resume-header h1 {
  font-size:    ${level === 1 ? 22 : level === 2 ? 20 : 17}pt !important;
  line-height: 1.05 !important;
  margin-bottom: ${level === 1 ? 3 : 2}pt !important;
}

/* Sidebar (bold template) */
.sidebar h1 {
  font-size: ${level === 1 ? 17 : level === 2 ? 15 : 13}pt !important;
  line-height: 1.2 !important;
}

/* Section spacing */
.section,
.section-experience {
  margin-bottom: ${level === 1 ? 7 : level === 2 ? 5 : 4}pt !important;
}
.section-title {
  margin-bottom: ${level === 1 ? 5 : level === 2 ? 4 : 3}pt !important;
}

/* Experience list gaps */
.positions-list {
  gap: ${level === 1 ? 6 : level === 2 ? 4 : 3}pt !important;
}
.timeline-list.positions-list {
  gap: ${level === 1 ? 7 : level === 2 ? 5 : 3}pt !important;
}

/* Per-position spacing */
.position {
  margin-bottom: ${level === 1 ? 6 : level === 2 ? 4 : 3}pt !important;
}
.position-header {
  margin-bottom: ${level === 1 ? 1 : 0}pt !important;
}
.position-title {
  margin-top: ${level === 1 ? 1 : 0}pt !important;
}
.position-bullets li {
  margin-bottom: ${level === 1 ? 1 : 0}pt !important;
}

/* Timeline entry spacing */
.entry-content {
  padding-bottom: 0 !important;
}
.entry-header {
  margin-bottom: ${level === 1 ? 2 : 1}pt !important;
}
.entry-body {
  margin-top: ${level === 1 ? 1 : 0}pt !important;
}
.entry-body p {
  margin-bottom: ${level === 1 ? 1 : 0}pt !important;
}

/* Summary */
.summary-text {
  padding-bottom: ${level === 1 ? 8 : level === 2 ? 6 : 4}pt !important;
  margin-bottom:  ${level === 1 ? 10 : level === 2 ? 7 : 5}pt !important;
}
.summary-block {
  margin-bottom: ${level === 1 ? 7 : level === 2 ? 5 : 4}pt !important;
}

/* Education */
.education-entry {
  margin-bottom: ${level === 1 ? 4 : level === 2 ? 3 : 2}pt !important;
}
`;

  if (level === 1) return base;

  const fontReductions = `
/* Font size reductions (level ${level}) */
body {
  font-size: ${level === 2 ? 8.5 : 8}pt !important;
}
.position-company,
.position-title,
.entry-company,
.entry-title,
.project-title,
.edu-institution {
  font-size: ${level === 2 ? 8.5 : 8}pt !important;
}
.position-bullets li,
.entry-body p,
.skills-list,
.side-skill-list li,
.side-item,
.side-bullets {
  font-size: ${level === 2 ? 8 : 7.5}pt !important;
}
.position-dates,
.position-location,
.entry-dates,
.edu-dates,
.edu-degree,
.contact-line,
.section-title {
  font-size: ${level === 2 ? 7.5 : 7}pt !important;
}
`;

  return base + fontReductions;
}
