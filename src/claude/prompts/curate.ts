import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { Profile } from '../../profile/schema.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const CURATE_SYSTEM = `You are a resume curator. Your job is to select the most relevant items from a candidate's profile for a specific job.

CRITICAL RULES — READ CAREFULLY:
1. You may ONLY select items by their exact ID.
2. You may NOT write new text, paraphrase, modify, or embellish any item.
3. You may reorder bullets within a position, but never move a bullet from one position to another.
4. You may OMIT positions, bullets, skills, projects, or certifications that are not relevant.
5. You may NOT invent skills, achievements, or context not present in the profile.
6. For bulletRefs: use ONLY the bullet IDs listed under each position's "Available bullets" section. Never use a bullet ID from a different position.
7. summaryRef must be "summary" if the summary is relevant, or null.

Your output will be validated — any invalid ID will abort the pipeline.`;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const curateTool: Tool = {
  name: 'curate_resume',
  description: 'Select profile items by ID for a tailored resume',
  input_schema: {
    type: 'object' as const,
    required: [
      'selectedPositions', 'selectedSkillIds', 'selectedProjectIds',
      'selectedEducationIds', 'selectedCertificationIds', 'summaryRef',
    ],
    properties: {
      selectedPositions: {
        type: 'array',
        description: 'Positions to include, with bullet IDs selected from that position only',
        items: {
          type: 'object',
          required: ['positionId', 'bulletRefs'],
          properties: {
            positionId: {
              type: 'string',
              description: 'The position\'s id field (e.g. "pos-0")',
            },
            bulletRefs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Bullet IDs to include. Must be from the position\'s own bullet list (e.g. ["b:pos-0:0", "b:pos-0:2"])',
            },
          },
        },
      },
      selectedSkillIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skill ids (e.g. ["skill-0", "skill-3"])',
      },
      selectedProjectIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project ids to include',
      },
      selectedEducationIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Education ids to include',
      },
      selectedCertificationIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Certification ids to include',
      },
      summaryRef: {
        type: ['string', 'null'],
        description: '"summary" to include the summary, or null to omit it',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Reference list builder — stable, path-derived IDs
// ---------------------------------------------------------------------------

export type RefKind = 'summary' | 'bullet';

export interface RefEntry {
  id: string;
  kind: RefKind;
  label: string;
  value: string;
  path: string;
  /** For bullets: the positionId this bullet belongs to */
  positionId?: string;
}

/**
 * Build the reference list for bullets and summary only.
 * Bullet IDs: "b:{positionId}:{bulletIndex}" — stable across re-runs as long
 * as the position id and bullet order are unchanged.
 * Summary ID: "summary"
 *
 * Skills, education, projects, and certifications are referenced by their
 * stable .id fields directly in the curation plan; they don't need refs here.
 */
export function buildRefList(profile: Profile): { refText: string; refMap: Map<string, RefEntry> } {
  const entries: RefEntry[] = [];

  // Summary
  if (profile.summary) {
    entries.push({
      id: 'summary',
      kind: 'summary',
      label: 'Summary',
      value: profile.summary.value,
      path: 'summary.value',
    });
  }

  // Position bullets
  for (let pi = 0; pi < profile.positions.length; pi++) {
    const pos = profile.positions[pi];
    for (let bi = 0; bi < pos.bullets.length; bi++) {
      const id = `b:${pos.id}:${bi}`;
      entries.push({
        id,
        kind: 'bullet',
        label: `${pos.title.value} @ ${pos.company.value}, Bullet ${bi}`,
        value: pos.bullets[bi].value,
        path: `positions[${pi}].bullets[${bi}].value`,
        positionId: pos.id,
      });
    }
  }

  const refMap = new Map(entries.map(e => [e.id, e]));

  // Build prompt text: group bullets by position for clarity
  const lines: string[] = [];

  if (profile.summary) {
    lines.push(`[summary] Summary: "${profile.summary.value}"`);
    lines.push('');
  }

  for (const pos of profile.positions) {
    lines.push(`Position: ${pos.title.value} @ ${pos.company.value} (id: ${pos.id})`);
    lines.push(`  Dates: ${pos.startDate.value} – ${pos.endDate?.value ?? 'Present'}`);
    lines.push('  Available bullets:');
    for (let bi = 0; bi < pos.bullets.length; bi++) {
      const id = `b:${pos.id}:${bi}`;
      lines.push(`    [${id}] "${pos.bullets[bi].value}"`);
    }
    lines.push('');
  }

  // Skills list
  if (profile.skills.length > 0) {
    lines.push('Skills (use id field):');
    for (const s of profile.skills) {
      lines.push(`  ${s.id}: ${s.name.value}`);
    }
    lines.push('');
  }

  // Education list
  if (profile.education.length > 0) {
    lines.push('Education (use id field):');
    for (const e of profile.education) {
      const deg = e.degree ? ` — ${e.degree.value}` : '';
      lines.push(`  ${e.id}: ${e.institution.value}${deg}`);
    }
    lines.push('');
  }

  // Projects list
  if (profile.projects.length > 0) {
    lines.push('Projects (use id field):');
    for (const p of profile.projects) {
      lines.push(`  ${p.id}: ${p.title.value}`);
    }
    lines.push('');
  }

  // Certifications list
  if (profile.certifications.length > 0) {
    lines.push('Certifications (use id field):');
    for (const c of profile.certifications) {
      lines.push(`  ${c.id}: ${c.name.value}${c.authority ? ` (${c.authority.value})` : ''}`);
    }
    lines.push('');
  }

  return { refText: lines.join('\n'), refMap };
}
