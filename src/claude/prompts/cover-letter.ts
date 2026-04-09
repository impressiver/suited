import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { WRITING_RULES } from './refine.ts';

export const coverLetterMarkdownTool: Tool = {
  name: 'cover_letter_markdown',
  description:
    'Return the full revised cover letter body as Markdown (paragraphs, optional lists, **bold** / *italic*).',
  input_schema: {
    type: 'object' as const,
    required: ['markdown'],
    properties: {
      markdown: {
        type: 'string',
        description: 'Complete cover letter body in Markdown only. No YAML front matter.',
      },
    },
  },
};

export const COVER_LETTER_LIGHT_REFINE_SYSTEM = `You are an editor helping refine a job application cover letter.

Goals:
- Improve grammar, clarity, concision, tone, and paragraph structure.
- Keep the same intent and level of detail as the draft.
- Do not add employers, dates, job titles, skills, metrics, education, or achievements the user did not already express in the draft or approved profile context below.
- Do not invent company-specific facts beyond framing the letter for the role; job posting text is context only, not permission to fabricate candidate facts.

Output: use the tool with the full revised letter body in Markdown.

If the draft is already strong, make only minimal edits.

${WRITING_RULES}`;

export const COVER_LETTER_SNIFF_SYSTEM = `You are a line editor for cover letters. Reduce phrasing that reads as generic, templated, or machine-generated: stock openers, perfectly parallel sentences everywhere, vague enthusiasm, or a uniformly polished voice with no natural variation.

Rules:
- Preserve facts and claims from the draft. Do not add employers, metrics, skills, or achievements that are not already there or clearly implied in the draft.
- Minimize changes where the prose already sounds human and specific.
- Prefer plain, direct wording. Remove phrases that scan as generic LLM output.
- Job posting context (if provided) is for tone alignment only, not for inventing candidate facts.

Output: use the tool with the full revised letter body in Markdown.

${WRITING_RULES}`;

export const COVER_LETTER_GENERATE_SYSTEM = `You are a professional writer drafting a cover letter for a job application.

Write a concise, specific cover letter that connects the candidate's actual experience to the role. The letter should read like it was written by a real person, not a template engine.

Rules:
- Use ONLY facts from the candidate profile provided. Do not invent achievements, metrics, companies, titles, or skills.
- Reference specific things from the job posting that connect to the candidate's real experience. Do not parrot the posting back.
- Keep it to 3-4 short paragraphs. No more than 250 words total.
- Opening line should be direct and specific to the role, not "I am writing to express my interest."
- Do not use "I'm excited" or "I'm passionate" or "I'm thrilled."
- Close with a simple, confident line. No "I look forward to the opportunity to discuss" or similar filler.
- Write in first person. Sound like a competent professional, not a sycophant.

${WRITING_RULES}

Output: use the tool with the complete cover letter body in Markdown.`;

export function buildCoverLetterGenerateUserMessage(
  profile: string,
  ctx: { company?: string; jobTitle?: string; jdExcerpt?: string },
): string {
  const parts: string[] = [`## Candidate profile\n`, profile.trimEnd()];
  if (ctx.company?.trim()) {
    parts.push(`\n\n## Target company\n${ctx.company.trim()}`);
  }
  if (ctx.jobTitle?.trim()) {
    parts.push(`\n\n## Target role\n${ctx.jobTitle.trim()}`);
  }
  if (ctx.jdExcerpt?.trim()) {
    const ex = ctx.jdExcerpt.trim();
    parts.push(`\n\n## Job description\n${ex.slice(0, 12000)}`);
  }
  parts.push('\n\nWrite the cover letter now.');
  return parts.join('');
}

export function buildCoverLetterAssistUserMessage(
  draft: string,
  ctx: { company?: string; jobTitle?: string; jdExcerpt?: string },
): string {
  const parts: string[] = [`## Cover letter draft (Markdown)\n`, draft.trimEnd()];
  if (ctx.company?.trim()) {
    parts.push(`\n\n## Target company (context)\n${ctx.company.trim()}`);
  }
  if (ctx.jobTitle?.trim()) {
    parts.push(`\n\n## Target role (context)\n${ctx.jobTitle.trim()}`);
  }
  if (ctx.jdExcerpt?.trim()) {
    const ex = ctx.jdExcerpt.trim();
    parts.push(`\n\n## Job description excerpt (context only)\n${ex.slice(0, 12000)}`);
  }
  return parts.join('');
}
