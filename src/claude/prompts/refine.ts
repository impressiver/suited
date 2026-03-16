import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { Profile, RefinementQuestion } from '../../profile/schema.js';

// ---------------------------------------------------------------------------
// Profile serialisation for the prompt
// ---------------------------------------------------------------------------

export function profileToRefineText(profile: Profile): string {
  const lines: string[] = [];

  lines.push(`Name: ${profile.contact.name.value}`);
  if (profile.summary) lines.push(`\nSummary: ${profile.summary.value}`);

  lines.push('\n## Experience');
  for (const pos of profile.positions) {
    const end = pos.endDate?.value ?? 'Present';
    lines.push(`\n### ${pos.id}: ${pos.title.value} at ${pos.company.value} (${pos.startDate.value} – ${end})`);
    if (pos.bullets.length === 0) {
      lines.push('  (no bullets)');
    } else {
      for (const b of pos.bullets) lines.push(`  • ${b.value}`);
    }
  }

  if (profile.skills.length > 0) {
    lines.push('\n## Skills');
    lines.push(profile.skills.map(s => s.name.value).join(', '));
  }

  if (profile.education.length > 0) {
    lines.push('\n## Education');
    for (const edu of profile.education) {
      const deg = [edu.degree?.value, edu.fieldOfStudy?.value].filter(Boolean).join(' in ');
      lines.push(`  ${edu.institution.value}${deg ? ` — ${deg}` : ''}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared writing rules — appended to every content-generating prompt
// ---------------------------------------------------------------------------

export const WRITING_RULES = `
Writing rules — follow these without exception:
- No em dashes (—) or en dashes used as separators. Use a comma, period, or rewrite the sentence.
- No filler openers: do not start bullets with "Successfully", "Effectively", "Proactively", "Leveraged", "Utilized", or "Facilitated".
- No AI clichés: avoid "leverage" (as a verb), "utilize", "streamline", "robust", "scalable", "cutting-edge", "innovative", "dynamic", "synergy", "paradigm shift", "game-changer", "delve", "harness", "foster", "spearhead".
- No throat-clearing phrases: "In order to", "It is worth noting that", "It is important to", "As a result of".
- Prefer plain verbs: "built" not "engineered a solution for", "led" not "spearheaded", "cut" not "reduced operational overhead".
- Bullets are one punchy sentence. No semicolon-joined compound bullets.
- No parenthetical asides inside bullets.
- Write how a person writes, not how a press release reads.`;

// ---------------------------------------------------------------------------
// Step 1 — Generate questions
// ---------------------------------------------------------------------------

export const REFINE_QUESTIONS_SYSTEM = `You are a career coach helping someone improve their resume. You will analyze their LinkedIn profile and generate targeted questions to gather missing context that will make the resume more impactful.

Focus on:
- Positions with vague, generic, or missing bullets (e.g. "Worked on X" with no specifics)
- Quantifiable achievements (team sizes, revenue impact, performance improvements, scale)
- Missing context for career transitions or gaps
- Technical specifics that would differentiate the candidate
- A missing or weak summary

Rules:
- Generate 3–8 questions maximum. Quality over quantity.
- Every question must reference the specific role and company.
- Questions should be answerable in 1–3 sentences.
- Do not ask about information already present in the profile.
- Mark a question optional: true only if the profile already has reasonable content for that section.
- Write questions in plain, direct language — no corporate or AI-sounding phrasing.`;

export const questionsToolSchema: Tool = {
  name: 'generate_refinement_questions',
  description: 'Generate targeted questions to improve specific sections of the profile',
  input_schema: {
    type: 'object' as const,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'targetId', 'context', 'question', 'optional'],
          properties: {
            id: { type: 'string', description: 'Unique ID, e.g. "q-0"' },
            targetId: { type: 'string', description: 'Profile section: a position id (e.g. "pos-0"), "summary", or "skills"' },
            context: { type: 'string', description: 'Brief framing, e.g. "Senior Engineer at Acme Corp (2020–2022)"' },
            question: { type: 'string' },
            optional: { type: 'boolean' },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Generate refinements from Q&A
// ---------------------------------------------------------------------------

export const REFINE_APPLY_SYSTEM = `You are a career coach. Based on a candidate's profile and their answers to your questions, generate improved resume content.

Rules:
- Only incorporate information the candidate explicitly provided in their answers.
- Do not invent, assume, or embellish beyond what was said.
- Write bullets in active voice, past tense for past roles, present for current.
- Each bullet should be specific and ideally quantified if the candidate provided numbers.
- Keep bullets concise — one sentence, under 120 characters where possible.
- If the candidate's answer does not improve a section, leave that section's bullets unchanged.
- For skills: only add skills the candidate explicitly mentioned.
${WRITING_RULES}`;

export const refinementsToolSchema: Tool = {
  name: 'generate_refinements',
  description: 'Generate improved profile content based on user Q&A',
  input_schema: {
    type: 'object' as const,
    required: ['positionRefinements'],
    properties: {
      positionRefinements: {
        type: 'array',
        description: 'Positions whose bullet points need to change. Only include if bullets themselves are being edited — NOT for removing positions or sections.',
        items: {
          type: 'object',
          required: ['positionId', 'bullets'],
          properties: {
            positionId: { type: 'string' },
            bullets: {
              type: 'array',
              description: 'Complete updated bullet list for this position',
              items: { type: 'string' },
            },
          },
        },
      },
      improvedSummary: {
        type: 'string',
        description: 'Improved summary text. Omit if the summary is not being changed.',
      },
      addedSkills: {
        type: 'array',
        description: 'New skills to add. Omit if not adding skills.',
        items: { type: 'string' },
      },
      removeSections: {
        type: 'array',
        description: 'Sections to remove entirely. Use this — not positionRefinements — when the instruction is to remove a whole section. Valid values: "projects", "certifications", "languages", "volunteer", "awards", "skills", "education", "summary".',
        items: { type: 'string' },
      },
      removePositionIds: {
        type: 'array',
        description: 'IDs of positions to remove from the experience section entirely (e.g. ["pos-2"]). Use this when the instruction is to remove a specific role — do not use positionRefinements for this.',
        items: { type: 'string' },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Direct prompt (targeted single-shot edit)
// ---------------------------------------------------------------------------

export const DIRECT_EDIT_SYSTEM = `You are a resume editor making targeted changes based on a specific user instruction.

Rules:
- Apply ONLY what the instruction explicitly asks for. Do not touch anything else.
- Do not improve, rewrite, or expand content beyond what was requested.
- Write bullets in active voice, past tense for past roles, present tense for current roles.
- Keep bullets concise — one sentence, under 120 characters where possible.
- If a category is unaffected by the instruction, omit it entirely — leave the field out of your response.

Field routing — use the correct field for each type of change:
- Editing bullet points within a position → positionRefinements
- Removing an entire section (projects, skills, certifications, etc.) → removeSections
- Removing a specific position from experience → removePositionIds
- Changing the summary text → improvedSummary
- Adding new skills → addedSkills
- NEVER use positionRefinements to accomplish a section removal or position removal.
${WRITING_RULES}`;

// ---------------------------------------------------------------------------
// Build the Q&A context string for step 2
// ---------------------------------------------------------------------------

export function buildQAContext(
  questions: RefinementQuestion[],
  answers: Record<string, string>,
): string {
  const lines = ['## Candidate Q&A\n'];
  for (const q of questions) {
    const answer = answers[q.id];
    if (!answer?.trim()) continue;
    lines.push(`**${q.context}**`);
    lines.push(`Q: ${q.question}`);
    lines.push(`A: ${answer.trim()}`);
    lines.push('');
  }
  return lines.join('\n');
}
