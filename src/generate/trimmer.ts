import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { callWithTool } from '../claude/client.ts';
import type { ResumeDocument } from '../profile/schema.ts';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

interface TrimOutput {
  removedBulletsByPosition: Array<{ positionIndex: number; bulletIndicesToRemove: number[] }>;
  removedSections: string[];
  removedPositionIndices: number[];
}

const trimTool: Tool = {
  name: 'trim_resume',
  description: 'Return a minimal set of cuts that will make the resume fit on one page.',
  input_schema: {
    type: 'object' as const,
    required: ['removedBulletsByPosition', 'removedSections', 'removedPositionIndices'],
    properties: {
      removedBulletsByPosition: {
        type: 'array',
        description:
          'Bullets to remove from specific positions. Only include positions where at least one bullet is removed.',
        items: {
          type: 'object',
          required: ['positionIndex', 'bulletIndicesToRemove'],
          properties: {
            positionIndex: { type: 'number', description: 'Zero-based index of the position' },
            bulletIndicesToRemove: {
              type: 'array',
              items: { type: 'number' },
              description: 'Zero-based indices of bullets to remove from this position',
            },
          },
        },
      },
      removedSections: {
        type: 'array',
        description:
          'Entire sections to remove. Valid values: "summary", "education", "skills", "projects", "certifications", "languages", "volunteer", "awards".',
        items: { type: 'string' },
      },
      removedPositionIndices: {
        type: 'array',
        description: 'Zero-based indices of positions to remove entirely.',
        items: { type: 'number' },
      },
    },
  },
};

const TRIM_SYSTEM = `You are a resume editor. The resume overflows one page and you must decide the minimum cuts needed to make it fit.

Prioritisation — cut in this order:
1. Bullets from the oldest / least relevant positions first.
2. Sections that are lowest signal for the role: languages, volunteer, awards, certifications, projects.
3. Entire old positions (never the most recent one).
4. Skills section (only if nothing else can be removed).
5. Summary (last resort).

Rules:
- Make the smallest number of cuts needed to eliminate the overflow. Do not over-trim.
- Never remove the most recent position entirely.
- Preserve at least 2 bullets per position you keep.
- Prefer removing a weak bullet over removing a whole section if it achieves the same reduction.
- Return empty arrays for fields where nothing is cut.`;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildTrimPrompt(doc: ResumeDocument, overflowPct: number): string {
  const lines: string[] = [];

  lines.push(
    `The resume is ~${overflowPct}% of one page height and must fit in 100%. Target cutting roughly ${overflowPct - 94}% of content (a little extra to avoid re-overflow after rendering).`,
  );
  lines.push('');

  if (doc.summary) {
    lines.push('## Summary');
    lines.push(doc.summary);
    lines.push('');
  }

  lines.push('## Experience (positions indexed from 0, newest first)');
  doc.positions.forEach((pos, i) => {
    lines.push(
      `\n### [${i}] ${pos.title} at ${pos.company} (${pos.startDate} – ${pos.endDate ?? 'Present'})`,
    );
    if (pos.bullets.length === 0) {
      lines.push('  (no bullets)');
    } else {
      pos.bullets.forEach((b, bi) => {
        lines.push(`  [${bi}] ${b}`);
      });
    }
  });

  const sections: string[] = [];
  if (doc.education.length) sections.push(`education (${doc.education.length} entries)`);
  if (doc.skills.length) sections.push(`skills (${doc.skills.length} items)`);
  if (doc.projects.length) sections.push(`projects (${doc.projects.length})`);
  if (doc.certifications.length) sections.push(`certifications (${doc.certifications.length})`);
  if (doc.languages.length) sections.push(`languages (${doc.languages.length})`);
  if (doc.volunteer.length) sections.push(`volunteer (${doc.volunteer.length})`);
  if (doc.awards.length) sections.push(`awards (${doc.awards.length})`);

  if (sections.length > 0) {
    lines.push('\n## Other sections present');
    lines.push(sections.join(', '));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function autoTrimToFit(
  doc: ResumeDocument,
  overflowRatio: number,
): Promise<ResumeDocument> {
  const overflowPct = Math.round(overflowRatio * 100);
  const prompt = buildTrimPrompt(doc, overflowPct);
  const output = await callWithTool<TrimOutput>(TRIM_SYSTEM, prompt, trimTool);

  let result = { ...doc };

  // Remove entire sections
  const removed = new Set(output.removedSections ?? []);
  if (removed.has('summary')) result = { ...result, summary: undefined };
  if (removed.has('education')) result = { ...result, education: [] };
  if (removed.has('skills')) result = { ...result, skills: [] };
  if (removed.has('projects')) result = { ...result, projects: [] };
  if (removed.has('certifications')) result = { ...result, certifications: [] };
  if (removed.has('languages')) result = { ...result, languages: [] };
  if (removed.has('volunteer')) result = { ...result, volunteer: [] };
  if (removed.has('awards')) result = { ...result, awards: [] };

  // Remove entire positions
  const removedPosIdxs = new Set(output.removedPositionIndices ?? []);

  // Remove individual bullets
  const bulletCuts = new Map<number, Set<number>>();
  for (const cut of output.removedBulletsByPosition ?? []) {
    bulletCuts.set(cut.positionIndex, new Set(cut.bulletIndicesToRemove));
  }

  // Apply bullet cuts using original indices, then filter removed positions
  const updatedPositions = result.positions
    .map((pos, origIdx) => {
      const cuts = bulletCuts.get(origIdx);
      if (!cuts || cuts.size === 0) return { pos, origIdx };
      return { pos: { ...pos, bullets: pos.bullets.filter((_, bi) => !cuts.has(bi)) }, origIdx };
    })
    .filter(({ origIdx }) => !removedPosIdxs.has(origIdx))
    .map(({ pos }) => pos);

  return { ...result, positions: updatedPositions };
}
