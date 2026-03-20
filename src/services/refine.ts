import { callWithTool, callWithToolStreaming } from '../claude/client.ts';
import {
  buildQAContext,
  DIRECT_EDIT_SYSTEM,
  EXPERT_POLISH_SYSTEM,
  profileToRefineText,
  questionsToolSchema,
  REFINE_APPLY_SYSTEM,
  REFINE_QUESTIONS_SYSTEM,
  refinementsToolSchema,
} from '../claude/prompts/refine.ts';
import type { Profile, RefinementQuestion } from '../profile/schema.ts';

// ---------------------------------------------------------------------------
// Tool payloads (same shapes as `commands/refine.ts`)
// ---------------------------------------------------------------------------

export interface QuestionsOutput {
  questions: RefinementQuestion[];
}

export interface RefinementsOutput {
  positionRefinements: Array<{ positionId: string; bullets: string[] }>;
  improvedSummary?: string;
  addedSkills?: string[];
  replacedSkills?: string[];
  removeSections?: string[];
  removePositionIds?: string[];
}

export type DiffBlock =
  | {
      kind: 'position-bullets';
      positionId: string;
      title: string;
      company: string;
      oldBullets: string[];
      newBullets: string[];
    }
  | { kind: 'summary'; old?: string; new: string }
  | { kind: 'skills-replaced'; oldNames: string[]; newNames: string[] }
  | { kind: 'skills-added'; names: string[] };

export type RefineStreamYield =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; result: Profile };

// ---------------------------------------------------------------------------
// Skill expansion — split bundled entries like "Languages: Python, Go"
// ---------------------------------------------------------------------------

function expandSkillEntry(s: string): string[] {
  const stripped = s.includes(': ') ? s.slice(s.indexOf(': ') + 2) : s;
  return stripped
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Apply refinements to a profile copy (Claude tool output)
// ---------------------------------------------------------------------------

export function applyRefinementsFromTool(
  profile: Profile,
  refinements: RefinementsOutput,
): Profile {
  const now = new Date().toISOString();
  const userEdit = (value: string) => ({
    value,
    source: { kind: 'user-edit' as const, editedAt: now },
  });

  const updated: Profile = { ...profile, positions: [...profile.positions] };

  for (const section of refinements.removeSections ?? []) {
    switch (section) {
      case 'projects':
        updated.projects = [];
        break;
      case 'certifications':
        updated.certifications = [];
        break;
      case 'languages':
        updated.languages = [];
        break;
      case 'volunteer':
        updated.volunteer = [];
        break;
      case 'awards':
        updated.awards = [];
        break;
      case 'skills':
        updated.skills = [];
        break;
      case 'education':
        updated.education = [];
        break;
      case 'summary':
        updated.summary = undefined;
        break;
    }
  }

  if (refinements.removePositionIds?.length) {
    const toRemove = new Set(refinements.removePositionIds);
    updated.positions = updated.positions.filter((p) => !toRemove.has(p.id));
  }

  for (const pr of refinements.positionRefinements) {
    const idx = updated.positions.findIndex((p) => p.id === pr.positionId);
    if (idx === -1) continue;
    updated.positions[idx] = {
      ...updated.positions[idx],
      bullets: pr.bullets.map((b) => userEdit(b)),
    };
  }

  if (refinements.improvedSummary?.trim()) {
    updated.summary = userEdit(refinements.improvedSummary.trim());
  }

  if (refinements.replacedSkills !== undefined) {
    const expanded = refinements.replacedSkills.flatMap(expandSkillEntry);
    updated.skills = expanded.map((s, i) => ({
      id: `skill-refined-${i}`,
      name: userEdit(s),
    }));
  } else if (refinements.addedSkills?.length) {
    const existingNames = new Set(updated.skills.map((s) => s.name.value.toLowerCase()));
    const nextId = updated.skills.length;
    const newSkills = refinements.addedSkills
      .flatMap(expandSkillEntry)
      .filter((s) => !existingNames.has(s.toLowerCase()))
      .map((s, i) => ({
        id: `skill-${nextId + i}`,
        name: userEdit(s),
      }));
    updated.skills = [...updated.skills, ...newSkills];
  }

  return updated;
}

/**
 * Pure diff between source and proposed refined profiles — drives TUI diff / review without console I/O.
 */
export function computeRefinementDiff(original: Profile, refined: Profile): DiffBlock[] {
  const blocks: DiffBlock[] = [];

  const changedPositions = refined.positions.filter((rpos) => {
    const opos = original.positions.find((p) => p.id === rpos.id);
    if (!opos) return false;
    return (
      JSON.stringify(opos.bullets.map((b) => b.value)) !==
      JSON.stringify(rpos.bullets.map((b) => b.value))
    );
  });

  for (const rpos of changedPositions) {
    const opos = original.positions.find((p) => p.id === rpos.id);
    if (!opos) continue;
    blocks.push({
      kind: 'position-bullets',
      positionId: rpos.id,
      title: rpos.title.value,
      company: rpos.company.value,
      oldBullets: opos.bullets.map((b) => b.value),
      newBullets: rpos.bullets.map((b) => b.value),
    });
  }

  const summaryChanged = refined.summary?.value !== original.summary?.value;
  if (summaryChanged && refined.summary) {
    blocks.push({
      kind: 'summary',
      old: original.summary?.value,
      new: refined.summary.value,
    });
  }

  const addedSkills = refined.skills.filter((s) => !original.skills.find((os) => os.id === s.id));
  const skillsReplaced =
    refined.skills.some((s) => s.id.startsWith('skill-refined-')) &&
    JSON.stringify(original.skills.map((s) => s.name.value)) !==
      JSON.stringify(refined.skills.map((s) => s.name.value));

  if (skillsReplaced) {
    blocks.push({
      kind: 'skills-replaced',
      oldNames: original.skills.map((s) => s.name.value),
      newNames: refined.skills.map((s) => s.name.value),
    });
  } else if (addedSkills.length > 0) {
    blocks.push({
      kind: 'skills-added',
      names: addedSkills.map((s) => s.name.value),
    });
  }

  return blocks;
}

export async function generateRefinementQuestions(
  profile: Profile,
  signal?: AbortSignal,
): Promise<RefinementQuestion[]> {
  const profileText = profileToRefineText(profile);
  const { questions } = await callWithTool<QuestionsOutput>(
    REFINE_QUESTIONS_SYSTEM,
    `Here is the candidate's profile:\n\n${profileText}`,
    questionsToolSchema,
    undefined,
    signal,
  );
  return questions;
}

/**
 * Runs the “apply” Claude tool for Q&A answers (steps 3–4 of refine); returns proposed profile before human review.
 */
export async function applyRefinements(
  profile: Profile,
  questions: RefinementQuestion[],
  answers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Profile> {
  const profileText = profileToRefineText(profile);
  const rawRefinements = await callWithTool<RefinementsOutput>(
    REFINE_APPLY_SYSTEM,
    `${profileText}\n\n${buildQAContext(questions, answers)}`,
    refinementsToolSchema,
    undefined,
    signal,
  );
  return applyRefinementsFromTool(profile, rawRefinements);
}

function buildPolishInstruction(
  profile: Profile,
  opts: { sections: string[]; positionIds?: string[] },
): string {
  const { sections, positionIds } = opts;
  const improvingParts: string[] = [];
  if (sections.includes('summary')) improvingParts.push('the summary');
  if (sections.includes('experience')) {
    if (positionIds?.length) {
      const labels = positionIds.map((id) => {
        const p = profile.positions.find((pos) => pos.id === id);
        return p ? `${p.title.value} at ${p.company.value} (${p.id})` : id;
      });
      improvingParts.push(`experience bullets for: ${labels.join('; ')}`);
    } else {
      improvingParts.push('all experience bullets');
    }
  }
  if (sections.includes('skills')) improvingParts.push('the skills list');

  const positionConstraint = positionIds?.length
    ? `\nFor experience, only improve bullets for these position IDs: ${positionIds.join(', ')}. Leave all other positions unchanged and omit them from positionRefinements.`
    : '';

  const skillsConstraint = sections.includes('skills')
    ? '\nFor skills: clean up and reformat the existing skills list for resume use using replacedSkills. Do not leave skills unchanged — always provide a cleaned list when skills are selected.'
    : '';

  return `Improve only: ${improvingParts.join(', ')}.${positionConstraint}${skillsConstraint}\n\nLeave all other sections exactly as they are — omit them from the output entirely.\n\n${profileToRefineText(profile)}`;
}

export async function* polishProfile(
  profile: Profile,
  opts: { sections: string[]; positionIds?: string[] },
  signal?: AbortSignal,
): AsyncGenerator<RefineStreamYield> {
  const instruction = buildPolishInstruction(profile, opts);
  const gen = callWithToolStreaming<RefinementsOutput>(
    EXPERT_POLISH_SYSTEM,
    instruction,
    refinementsToolSchema,
    undefined,
    signal,
  );
  let last: RefinementsOutput | undefined;
  for await (const ev of gen) {
    if (ev.type === 'done') {
      last = ev.result;
    } else {
      yield ev;
    }
  }
  if (!last) throw new Error('polishProfile: no result from model');
  yield { type: 'done', result: applyRefinementsFromTool(profile, last) };
}

export async function* applyDirectEdit(
  profile: Profile,
  instructions: string,
  signal?: AbortSignal,
): AsyncGenerator<RefineStreamYield> {
  const trimmed = instructions.trim();
  if (!trimmed) {
    yield { type: 'done', result: profile };
    return;
  }
  const profileText = profileToRefineText(profile);
  const gen = callWithToolStreaming<RefinementsOutput>(
    DIRECT_EDIT_SYSTEM,
    `${profileText}\n\n## User Instruction\n${trimmed}`,
    refinementsToolSchema,
    undefined,
    signal,
  );
  let last: RefinementsOutput | undefined;
  for await (const ev of gen) {
    if (ev.type === 'done') {
      last = ev.result;
    } else {
      yield ev;
    }
  }
  if (!last) throw new Error('applyDirectEdit: no result from model');
  yield { type: 'done', result: applyRefinementsFromTool(profile, last) };
}
