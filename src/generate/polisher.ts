import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { callWithTool } from '../claude/client.ts';
import { CONTENT_TWEAK_SYSTEM, JOB_TAILORED_POLISH_SYSTEM } from '../claude/prompts/refine.ts';
import type { JobAnalysis, ResumeDocument } from '../profile/schema.ts';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

interface PolishOutput {
  positions: Array<{ index: number; bullets: string[] }>;
  summary?: string;
}

const polishTool: Tool = {
  name: 'polish_resume',
  description:
    'Return polished bullets for positions that were improved. Only include positions where at least one bullet changed.',
  input_schema: {
    type: 'object' as const,
    required: ['positions'],
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['index', 'bullets'],
          properties: {
            index: {
              type: 'number',
              description: 'Zero-based index of the position in the positions array',
            },
            bullets: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Complete polished bullet list for this position (same length as original)',
            },
          },
        },
      },
      summary: {
        type: 'string',
        description: 'Polished summary if improved, omit entirely if unchanged',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Build prompt text
// ---------------------------------------------------------------------------

function buildPolishPrompt(doc: ResumeDocument, jobAnalysis: JobAnalysis): string {
  const lines: string[] = [];

  lines.push('## Target Role');
  lines.push(`Company: ${jobAnalysis.company}`);
  lines.push(`Title: ${jobAnalysis.title}`);
  lines.push(`Industry: ${jobAnalysis.industry}`);
  lines.push(`Key Skills: ${jobAnalysis.keySkills.join(', ')}`);
  if (jobAnalysis.mustHaves.length > 0) {
    lines.push(`Must-Have Qualifications: ${jobAnalysis.mustHaves.join('; ')}`);
  }
  lines.push('');

  if (doc.summary) {
    lines.push('## Summary');
    lines.push(doc.summary);
    lines.push('');
  }

  lines.push('## Experience (positions indexed from 0)');
  doc.positions.forEach((pos, i) => {
    lines.push(
      `\n### [${i}] ${pos.title} at ${pos.company} (${pos.startDate} - ${pos.endDate ?? 'Present'})`,
    );
    if (pos.bullets.length === 0) {
      lines.push('  (no bullets)');
    } else {
      for (const b of pos.bullets) {
        lines.push(`  • ${b}`);
      }
    }
  });

  lines.push('');
  lines.push(`## Instructions`);
  lines.push(
    `Polish the experience bullets to better position the candidate for ${jobAnalysis.title} at ${jobAnalysis.company}.`,
  );
  lines.push(
    '- Bring forward relevance to the must-have qualifications where it exists in the original text.',
  );
  lines.push('- Do not add any fact, technology, or metric not in the original.');
  lines.push('- Only return positions where you actually improved a bullet.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Auto-polishes a ResumeDocument's bullets to better fit a specific job.
 * Applied automatically after curation — no user interaction required.
 * Returns a new ResumeDocument with improved bullet text (no facts added).
 */
export async function polishResumeForJob(
  doc: ResumeDocument,
  jobAnalysis: JobAnalysis,
): Promise<ResumeDocument> {
  if (doc.positions.length === 0) return doc;

  const prompt = buildPolishPrompt(doc, jobAnalysis);
  const output = await callWithTool<PolishOutput>(JOB_TAILORED_POLISH_SYSTEM, prompt, polishTool);

  // Apply polished bullets back to the document
  const updatedPositions = [...doc.positions];
  for (const change of output.positions ?? []) {
    const { index, bullets } = change;
    if (index < 0 || index >= updatedPositions.length) continue;
    if (!Array.isArray(bullets) || bullets.length === 0) continue;
    updatedPositions[index] = { ...updatedPositions[index], bullets };
  }

  const updatedDoc: ResumeDocument = { ...doc, positions: updatedPositions };
  if (output.summary?.trim()) updatedDoc.summary = output.summary.trim();

  return updatedDoc;
}

// ---------------------------------------------------------------------------
// Content tweak — natural language instruction → Claude rewrites
// ---------------------------------------------------------------------------

function buildTweakPrompt(doc: ResumeDocument, instruction: string): string {
  const lines: string[] = [];

  lines.push(`## Instruction`);
  lines.push(instruction);
  lines.push('');

  if (doc.summary) {
    lines.push('## Summary');
    lines.push(doc.summary);
    lines.push('');
  }

  lines.push('## Experience (positions indexed from 0)');
  doc.positions.forEach((pos, i) => {
    lines.push(
      `\n### [${i}] ${pos.title} at ${pos.company} (${pos.startDate} - ${pos.endDate ?? 'Present'})`,
    );
    if (pos.bullets.length === 0) {
      lines.push('  (no bullets)');
    } else {
      for (const b of pos.bullets) {
        lines.push(`  • ${b}`);
      }
    }
  });

  return lines.join('\n');
}

/**
 * Rewrites resume bullets according to a natural language instruction.
 * Restricts to rephrasing/reframing existing content — does NOT add new facts.
 */
export async function tweakResumeContent(
  doc: ResumeDocument,
  instruction: string,
): Promise<ResumeDocument> {
  if (doc.positions.length === 0) return doc;

  const prompt = buildTweakPrompt(doc, instruction);
  const output = await callWithTool<PolishOutput>(CONTENT_TWEAK_SYSTEM, prompt, polishTool);

  const updatedPositions = [...doc.positions];
  for (const change of output.positions ?? []) {
    const { index, bullets } = change;
    if (index < 0 || index >= updatedPositions.length) continue;
    if (!Array.isArray(bullets) || bullets.length === 0) continue;
    updatedPositions[index] = { ...updatedPositions[index], bullets };
  }

  const updatedDoc: ResumeDocument = { ...doc, positions: updatedPositions };
  if (output.summary?.trim()) updatedDoc.summary = output.summary.trim();

  return updatedDoc;
}
