import {
  loadSource, saveRefined, loadRefined, hashSource,
  refinedJsonPath, refinedMdPath, sourceJsonPath,
  loadJobs, loadJobRefinement, saveJobRefinement, deleteJobRefinement,
} from '../profile/serializer.js';
import { profileToMarkdown, markdownToProfile } from '../profile/markdown.js';
import { callWithTool } from '../claude/client.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import {
  profileToRefineText, REFINE_QUESTIONS_SYSTEM, questionsToolSchema,
  REFINE_APPLY_SYSTEM, refinementsToolSchema, buildQAContext,
  DIRECT_EDIT_SYSTEM, EXPERT_POLISH_SYSTEM,
} from '../claude/prompts/refine.js';
import { curateForJob } from '../generate/curator.js';
import {
  Profile, Sourced, RefinementQuestion, RefinementSession, JobRefinement,
} from '../profile/schema.js';
import { c } from '../utils/colors.js';
import { evaluateProfile, printProfileEvaluation, enrichFindingsWithUserInput } from '../generate/consultant.js';
import {
  APPLY_PROFILE_FEEDBACK_SYSTEM, buildProfileFeedbackPrompt, ConsultantFinding,
} from '../claude/prompts/consultant.js';

export interface RefineOptions {
  profileDir?: string;
}

// ---------------------------------------------------------------------------
// Types returned by Claude tools
// ---------------------------------------------------------------------------

interface QuestionsOutput {
  questions: RefinementQuestion[];
}

interface RefinementsOutput {
  positionRefinements: Array<{ positionId: string; bullets: string[] }>;
  improvedSummary?: string;
  addedSkills?: string[];
  replacedSkills?: string[];
  removeSections?: string[];
  removePositionIds?: string[];
}

// ---------------------------------------------------------------------------
// Apply refinements to a profile copy
// ---------------------------------------------------------------------------

function applyRefinements(profile: Profile, refinements: RefinementsOutput): Profile {
  const now = new Date().toISOString();
  const userEdit = (value: string) =>
    ({ value, source: { kind: 'user-edit' as const, editedAt: now } });

  const updated: Profile = { ...profile, positions: [...profile.positions] };

  // Remove entire sections
  for (const section of refinements.removeSections ?? []) {
    switch (section) {
      case 'projects':       updated.projects       = []; break;
      case 'certifications': updated.certifications = []; break;
      case 'languages':      updated.languages      = []; break;
      case 'volunteer':      updated.volunteer      = []; break;
      case 'awards':         updated.awards         = []; break;
      case 'skills':         updated.skills         = []; break;
      case 'education':      updated.education      = []; break;
      case 'summary':        updated.summary        = undefined; break;
    }
  }

  // Remove specific positions
  if (refinements.removePositionIds?.length) {
    const toRemove = new Set(refinements.removePositionIds);
    updated.positions = updated.positions.filter(p => !toRemove.has(p.id));
  }

  // Update bullets within positions
  for (const pr of refinements.positionRefinements) {
    const idx = updated.positions.findIndex(p => p.id === pr.positionId);
    if (idx === -1) continue;
    updated.positions[idx] = {
      ...updated.positions[idx],
      bullets: pr.bullets.map(b => userEdit(b)),
    };
  }

  if (refinements.improvedSummary?.trim()) {
    updated.summary = userEdit(refinements.improvedSummary.trim());
  }

  if (refinements.replacedSkills !== undefined) {
    updated.skills = refinements.replacedSkills.map((s, i) => ({
      id: `skill-refined-${i}`,
      name: userEdit(s),
    }));
  } else if (refinements.addedSkills?.length) {
    const existingNames = new Set(updated.skills.map(s => s.name.value.toLowerCase()));
    const nextId = updated.skills.length;
    const newSkills = refinements.addedSkills
      .filter(s => !existingNames.has(s.toLowerCase()))
      .map((s, i) => ({
        id: `skill-${nextId + i}`,
        name: userEdit(s),
      }));
    updated.skills = [...updated.skills, ...newSkills];
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Interactive Q&A
// ---------------------------------------------------------------------------

async function collectAnswers(
  questions: RefinementQuestion[],
): Promise<Record<string, string>> {
  const { default: inquirer } = await import('inquirer');
  const answers: Record<string, string> = {};

  console.log(`\nClaude has ${c.value(String(questions.length))} question(s) to improve your profile:\n`);

  for (const q of questions) {
    // Context is embedded in the message so Inquirer controls all output
    // and cursor position stays correct. A preceding console.log() causes
    // Inquirer v12 to miscalculate the cursor location on re-render.
    const result = await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message: `${c.muted(`[${q.context}]`)} ${q.question}${q.optional ? c.muted(' (optional)') : ''}`,
      },
    ]);
    const answer = (result as { answer: string }).answer.trim();
    if (answer) answers[q.id] = answer;
  }

  return answers;
}

// ---------------------------------------------------------------------------
// Per-bullet review helpers
// ---------------------------------------------------------------------------

async function reviewBullets(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  positionLabel: string,
  oldBullets: string[],
  newBullets: string[],
  now: string,
): Promise<Sourced<string>[]> {
  const userEdit = (v: string): Sourced<string> =>
    ({ value: v, source: { kind: 'user-edit', editedAt: now } });

  console.log(`\n  ${c.value(positionLabel)}`);

  const result: Sourced<string>[] = [];

  for (let i = 0; i < newBullets.length; i++) {
    const proposed = newBullets[i];
    const original = oldBullets[i];
    const changed = proposed !== original;

    if (!changed) {
      result.push(userEdit(proposed));
      continue;
    }

    console.log();
    if (original) console.log(`    ${c.removed(`- ${original}`)}`);
    console.log(`    ${c.added(`+ ${proposed}`)}`);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'This bullet:',
        choices: [
          { value: 'accept', name: 'Accept' },
          { value: 'edit',   name: 'Edit'   },
          { value: 'keep',   name: 'Keep original' },
        ],
      },
    ]) as { action: string };

    if (action === 'keep') {
      if (original) result.push(userEdit(original));
    } else if (action === 'edit') {
      const { edited } = await inquirer.prompt([
        { type: 'input', name: 'edited', message: 'Edit bullet:', default: proposed },
      ]) as { edited: string };
      if (edited.trim()) result.push(userEdit(edited.trim()));
    } else {
      result.push(userEdit(proposed));
    }
  }

  // Preserve any original bullets beyond the new list length
  for (let i = newBullets.length; i < oldBullets.length; i++) {
    result.push(userEdit(oldBullets[i]));
  }

  return result;
}

async function reviewSummary(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  oldSummary: string | undefined,
  newSummary: string,
  now: string,
): Promise<Sourced<string> | undefined> {
  const userEdit = (v: string): Sourced<string> =>
    ({ value: v, source: { kind: 'user-edit', editedAt: now } });

  console.log(`\n  ${c.value('Summary')}`);
  if (oldSummary) console.log(`    ${c.removed(`- ${oldSummary}`)}`);
  console.log(`    ${c.added(`+ ${newSummary}`)}`);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'This summary:',
      choices: [
        { value: 'accept', name: 'Accept' },
        { value: 'edit',   name: 'Edit'   },
        { value: 'keep',   name: 'Keep original' },
      ],
    },
  ]) as { action: string };

  if (action === 'keep') return oldSummary ? userEdit(oldSummary) : undefined;
  if (action === 'edit') {
    const { edited } = await inquirer.prompt([
      { type: 'input', name: 'edited', message: 'Edit summary:', default: newSummary },
    ]) as { edited: string };
    return edited.trim() ? userEdit(edited.trim()) : undefined;
  }
  return userEdit(newSummary);
}

// ---------------------------------------------------------------------------
// Review & confirm proposed changes
// ---------------------------------------------------------------------------

async function reviewRefinements(
  original: Profile,
  refined: Profile,
): Promise<Profile> {
  const { default: inquirer } = await import('inquirer');

  // Collect what changed
  const changedPositions = refined.positions.filter(rpos => {
    const opos = original.positions.find(p => p.id === rpos.id);
    if (!opos) return false;
    return JSON.stringify(opos.bullets.map(b => b.value)) !==
           JSON.stringify(rpos.bullets.map(b => b.value));
  });
  const summaryChanged = refined.summary?.value !== original.summary?.value;
  const addedSkills = refined.skills.filter(s => !original.skills.find(os => os.id === s.id));
  const skillsReplaced =
    refined.skills.some(s => s.id.startsWith('skill-refined-')) &&
    JSON.stringify(original.skills.map(s => s.name.value)) !==
    JSON.stringify(refined.skills.map(s => s.name.value));

  if (!changedPositions.length && !summaryChanged && !addedSkills.length && !skillsReplaced) {
    console.log(`\n  ${c.muted('No changes proposed.')}`);
    return original;
  }

  // Show summary of all proposed changes
  for (const rpos of changedPositions) {
    const opos = original.positions.find(p => p.id === rpos.id)!;
    console.log(`\n  ${c.value(`${rpos.title.value} @ ${rpos.company.value}`)}`);
    opos.bullets.forEach(b => console.log(`    ${c.removed(`- ${b.value}`)}`));
    rpos.bullets.forEach(b => console.log(`    ${c.added(`+ ${b.value}`)}`));
  }
  if (summaryChanged) {
    console.log(`\n  ${c.value('Summary')}`);
    if (original.summary) console.log(`    ${c.removed(`- ${original.summary.value}`)}`);
    if (refined.summary)  console.log(`    ${c.added(`+ ${refined.summary.value}`)}`);
  }
  if (skillsReplaced) {
    console.log(`\n  ${c.value('Skills (cleaned up for resume use):')}`);
    console.log(`    ${c.removed(`- ${original.skills.map(s => s.name.value).join(', ')}`)}`);
    console.log(`    ${c.added(`+ ${refined.skills.map(s => s.name.value).join(', ')}`)}`);
  } else if (addedSkills.length > 0) {
    console.log(`\n  ${c.value('Added skills:')} ${c.added(addedSkills.map(s => s.name.value).join(', '))}`);
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Accept these changes?',
      choices: [
        { value: 'accept', name: 'Accept all' },
        { value: 'review', name: 'Review individually' },
        { value: 'discard', name: 'Discard — keep original' },
      ],
    },
  ]) as { action: string };

  if (action === 'discard') return original;
  if (action === 'accept') return refined;

  // --- Review individually ---
  const now = new Date().toISOString();
  const result: Profile = { ...refined, positions: [...refined.positions] };

  for (const rpos of changedPositions) {
    const opos = original.positions.find(p => p.id === rpos.id)!;
    const label = `${rpos.title.value} @ ${rpos.company.value}`;
    const finalBullets = await reviewBullets(
      inquirer, label,
      opos.bullets.map(b => b.value),
      rpos.bullets.map(b => b.value),
      now,
    );
    const idx = result.positions.findIndex(p => p.id === rpos.id);
    result.positions[idx] = { ...result.positions[idx], bullets: finalBullets };
  }

  if (summaryChanged && refined.summary) {
    result.summary = await reviewSummary(
      inquirer,
      original.summary?.value,
      refined.summary.value,
      now,
    );
  }

  if (skillsReplaced) {
    console.log();
    const { kept } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'kept',
        message: 'Select skills to keep from the cleaned-up list:',
        choices: refined.skills.map(s => ({ name: s.name.value, value: s.id, checked: true })),
      },
    ]) as { kept: string[] };
    const keptSet = new Set(kept);
    result.skills = refined.skills.filter(s => keptSet.has(s.id));
  } else if (addedSkills.length > 0) {
    console.log();
    const { kept } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'kept',
        message: 'Which new skills would you like to add?',
        choices: addedSkills.map(s => ({ name: s.name.value, value: s.id, checked: true })),
      },
    ]) as { kept: string[] };
    result.skills = [
      ...original.skills,
      ...addedSkills.filter(s => kept.includes(s.id)),
    ];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Direct prompt — targeted single-shot edit
// ---------------------------------------------------------------------------

async function applyDirectPrompt(
  profile: Profile,
  session: RefinementSession,
  profileDir: string,
): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  const { instruction } = await inquirer.prompt([
    { type: 'input', name: 'instruction', message: 'What would you like to change?' },
  ]) as { instruction: string };

  if (!instruction.trim()) {
    console.log(c.muted('No instruction provided.'));
    return;
  }

  console.log(c.muted('\nApplying changes with Claude...'));

  const profileText = profileToRefineText(profile);
  const rawRefinements = await callWithTool<RefinementsOutput>(
    DIRECT_EDIT_SYSTEM,
    `${profileText}\n\n## User Instruction\n${instruction.trim()}`,
    refinementsToolSchema,
  );

  const proposedProfile = applyRefinements(profile, rawRefinements);
  const finalProfile = await reviewRefinements(profile, proposedProfile);

  await saveRefined({ profile: finalProfile, session }, profileDir);
  await profileToMarkdown(finalProfile, refinedMdPath(profileDir));

  console.log(`\n${c.ok} ${c.success('Refined data saved')}`);
  console.log(`   ${c.path(refinedJsonPath(profileDir))}`);
}

// ---------------------------------------------------------------------------
// Expert polish — proactive writing improvement on selected sections
// ---------------------------------------------------------------------------

async function applyExpertPolish(
  profile: Profile,
  session: RefinementSession,
  profileDir: string,
): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  // Build section choices from what the profile actually contains
  const sectionChoices = [
    profile.summary
      ? { name: 'Summary', value: 'summary', checked: true }
      : null,
    profile.positions.length > 0
      ? { name: `Experience bullets  (${profile.positions.length} position${profile.positions.length === 1 ? '' : 's'})`, value: 'experience', checked: true }
      : null,
    profile.skills.length > 0
      ? { name: `Skills  (${profile.skills.length} — clean up for resume use)`, value: 'skills', checked: true }
      : null,
  ].filter(Boolean) as Array<{ name: string; value: string; checked: boolean }>;

  if (sectionChoices.length === 0) {
    console.log(c.muted('No sections available to polish.'));
    return;
  }

  const { selectedSections } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedSections',
      message: 'Select sections for expert polish:',
      choices: sectionChoices,
    },
  ]) as { selectedSections: string[] };

  if (selectedSections.length === 0) return;

  // If experience is selected and there are multiple positions, let the user narrow down
  let targetPositionIds: string[] | null = null; // null = all
  if (selectedSections.includes('experience') && profile.positions.length > 1) {
    const { scope } = await inquirer.prompt([
      {
        type: 'list',
        name: 'scope',
        message: 'Polish experience bullets for:',
        choices: [
          { name: 'All positions', value: 'all' },
          { name: 'Choose specific positions…', value: 'select' },
        ],
      },
    ]) as { scope: string };

    if (scope === 'select') {
      const { chosen } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'chosen',
          message: 'Select positions to polish:',
          choices: profile.positions.map(p => ({
            name: `${p.title.value}  ${c.muted(`@ ${p.company.value}`)}`,
            value: p.id,
            checked: true,
          })),
        },
      ]) as { chosen: string[] };
      targetPositionIds = chosen.length > 0 ? chosen : null;
    }
  }

  // Describe what we're improving for the prompt
  const improvingParts: string[] = [];
  if (selectedSections.includes('summary')) improvingParts.push('the summary');
  if (selectedSections.includes('experience')) {
    if (targetPositionIds) {
      const labels = targetPositionIds.map(id => {
        const p = profile.positions.find(pos => pos.id === id);
        return p ? `${p.title.value} at ${p.company.value} (${p.id})` : id;
      });
      improvingParts.push(`experience bullets for: ${labels.join('; ')}`);
    } else {
      improvingParts.push('all experience bullets');
    }
  }
  if (selectedSections.includes('skills')) improvingParts.push('the skills list');

  const positionConstraint = targetPositionIds
    ? `\nFor experience, only improve bullets for these position IDs: ${targetPositionIds.join(', ')}. Leave all other positions unchanged and omit them from positionRefinements.`
    : '';

  const skillsConstraint = selectedSections.includes('skills')
    ? '\nFor skills: clean up and reformat the existing skills list for resume use using replacedSkills. Do not leave skills unchanged — always provide a cleaned list when skills are selected.'
    : '';

  const instruction = `Improve only: ${improvingParts.join(', ')}.${positionConstraint}${skillsConstraint}\n\nLeave all other sections exactly as they are — omit them from the output entirely.\n\n${profileToRefineText(profile)}`;

  console.log(c.muted(`\nPolishing ${improvingParts.join(' and ')} with Claude...`));

  const rawRefinements = await callWithTool<RefinementsOutput>(
    EXPERT_POLISH_SYSTEM,
    instruction,
    refinementsToolSchema,
  );

  const proposedProfile = applyRefinements(profile, rawRefinements);
  const finalProfile = await reviewRefinements(profile, proposedProfile);

  if (finalProfile === profile) return; // nothing accepted

  await saveRefined({ profile: finalProfile, session }, profileDir);
  await profileToMarkdown(finalProfile, refinedMdPath(profileDir));
  console.log(`\n${c.ok} ${c.success('Polished profile saved')}`);
  console.log(`   ${c.path(refinedJsonPath(profileDir))}`);
}

// ---------------------------------------------------------------------------
// Hiring consultant profile review
// ---------------------------------------------------------------------------

async function runConsultantReview(
  profile: Profile,
  session: RefinementSession,
  profileDir: string,
): Promise<Profile> {
  const { default: inquirer } = await import('inquirer');

  console.log(c.muted('\nRunning hiring consultant review...'));
  let evaluation;
  try {
    evaluation = await evaluateProfile(profile);
  } catch (err) {
    console.log(c.muted(`  Consultant review unavailable: ${(err as Error).message}`));
    return profile;
  }

  printProfileEvaluation(evaluation);

  if (evaluation.improvements.length === 0) return profile;

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Incorporate consultant feedback?',
    choices: [
      { value: 'skip',       name: 'Skip' },
      { value: 'all',        name: 'Apply all suggestions' },
      { value: 'pick',       name: 'Choose which suggestions to apply' },
    ],
  }]) as { action: string };

  if (action === 'skip') return profile;

  let selected: ConsultantFinding[] = evaluation.improvements;
  if (action === 'pick') {
    const { chosen } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'chosen',
      message: 'Select suggestions to apply:',
      choices: evaluation.improvements.map((imp, i) => ({
        name: `${imp.area}: ${imp.issue}`,
        value: i,
        checked: true,
      })),
    }]) as { chosen: number[] };
    selected = chosen.map(i => evaluation.improvements[i]);
    if (selected.length === 0) return profile;
  }

  // Let Claude determine which findings need additional facts from the candidate
  const profileText = profileToRefineText(profile);
  selected = await enrichFindingsWithUserInput(selected, inquirer, profileText);

  console.log(c.muted('\nApplying consultant feedback with Claude...'));
  let rawRefinements;
  try {
    rawRefinements = await callWithTool<RefinementsOutput>(
      APPLY_PROFILE_FEEDBACK_SYSTEM,
      buildProfileFeedbackPrompt(profileText, selected),
      refinementsToolSchema,
    );
  } catch (err) {
    console.log(c.muted(`  Failed to apply feedback: ${(err as Error).message}`));
    return profile;
  }

  const proposedProfile = applyRefinements(profile, rawRefinements);
  const finalProfile = await reviewRefinements(profile, proposedProfile);

  if (finalProfile !== profile) {
    await saveRefined({ profile: finalProfile, session }, profileDir);
    await profileToMarkdown(finalProfile, refinedMdPath(profileDir));
    console.log(`\n${c.ok} ${c.success('Profile updated with consultant feedback.')}`);
  }

  return finalProfile;
}

// ---------------------------------------------------------------------------
// Job refinements — per-job curation plans managed from refine command
// ---------------------------------------------------------------------------

async function runJobRefinements(
  profile: Profile,
  session: RefinementSession,
  profileDir: string,
): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  const jobs = await loadJobs(profileDir);
  if (jobs.length === 0) {
    console.log(c.muted('  No saved job descriptions yet. Run "resume generate" with a JD first.'));
    return;
  }

  // Build choice list showing which jobs already have stored refinements
  const refinementStatus = await Promise.all(
    jobs.map(async j => {
      const r = await loadJobRefinement(profileDir, j.id);
      return { job: j, refinement: r };
    }),
  );

  const { jobId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'jobId',
      message: 'Select a job to manage its curation:',
      choices: [
        ...refinementStatus.map(({ job, refinement }) => ({
          name: `${job.company} — ${job.title}  ${c.muted(refinement
            ? `refined ${new Date(refinement.createdAt).toLocaleDateString()}`
            : 'not yet curated')}`,
          value: job.id,
        })),
        { name: c.muted('← Back'), value: '__back__' },
      ],
    },
  ]) as { jobId: string };

  if (jobId === '__back__') return;

  const { job, refinement } = refinementStatus.find(r => r.job.id === jobId)!;

  if (refinement) {
    console.log(`\n${c.ok} Stored refinement for ${c.value(`${job.company} — ${job.title}`)}`);
    console.log(`   Curated ${new Date(refinement.createdAt).toLocaleString()}`);
    console.log(`   ${refinement.plan.selectedPositions.length} positions · ${refinement.plan.selectedSkillIds.length} skills`);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { value: 'done',   name: 'Done' },
          { value: 'recurate', name: '↻ Re-curate (regenerate with Claude)' },
          { value: 'delete', name: '✗ Delete stored refinement' },
        ],
      },
    ]) as { action: string };

    if (action === 'done') return;
    if (action === 'delete') {
      await deleteJobRefinement(jobId, profileDir);
      console.log(c.muted(`  Deleted refinement for ${job.company} — ${job.title}.`));
      return;
    }
    // fall through to re-curate
  } else {
    console.log(`\nNo stored refinement for ${c.value(`${job.company} — ${job.title}`)}. Curating now...`);
  }

  // Run curation
  console.log(c.muted('\nCurating with Claude...'));
  let curatorResult;
  try {
    curatorResult = await curateForJob(profile, {
      company: job.company,
      title: job.title,
      industry: refinement?.jobAnalysis.industry ?? 'general',
      seniority: refinement?.jobAnalysis.seniority ?? 'mid',
      keySkills: refinement?.jobAnalysis.keySkills ?? [],
      mustHaves: refinement?.jobAnalysis.mustHaves ?? [],
      niceToHaves: refinement?.jobAnalysis.niceToHaves ?? [],
      summary: job.text,
    });
  } catch (err) {
    console.error(`\n${c.fail} ${c.error(`Curation failed: ${(err as Error).message}`)}`);
    return;
  }

  // If we don't have a full job analysis from before, re-analyze the JD text inline
  // (curateForJob uses what we pass; for a fresh curate we at minimum need the job text)
  const newRefinement: JobRefinement = {
    jobId,
    createdAt: new Date().toISOString(),
    jobAnalysis: refinement?.jobAnalysis ?? {
      company: job.company,
      title: job.title,
      industry: 'general',
      seniority: 'mid',
      keySkills: [],
      mustHaves: [],
      niceToHaves: [],
      summary: job.text.slice(0, 200),
    },
    plan: curatorResult.plan,
  };
  await saveJobRefinement(newRefinement, profileDir);

  console.log(`\n${c.ok} ${c.success('Refinement saved')} for ${c.value(`${job.company} — ${job.title}`)}`);
  console.log(`   ${curatorResult.plan.selectedPositions.length} positions · ${curatorResult.plan.selectedSkillIds.length} skills`);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function runRefine(options: RefineOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  if (!(await fileExists(sourceJsonPath(profileDir)))) {
    throw new Error(`source.json not found in ${profileDir}. Run 'resume import' first.`);
  }

  const currentHash = await hashSource(profileDir);

  // Check if a refinement already exists
  if (await fileExists(refinedJsonPath(profileDir))) {
    const existing = await loadRefined(profileDir);
    const sourceChanged = existing.session.sourceHash !== currentHash;
    const refinedAt = new Date(existing.session.conductedAt).toLocaleString();

    if (!sourceChanged) {
      console.log(`${c.ok} ${c.success('Refinement already complete')} ${c.muted(`(${refinedAt})`)}`);
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { value: 'skip',       name: 'Skip — use existing refinement' },
            { value: 'consultant', name: 'Consultant review — get professional feedback' },
            { value: 'polish',     name: 'Expert polish — improve writing quality' },
            { value: 'prompt',     name: 'Prompt — tell Claude what to change' },
            { value: 'edit',       name: 'Edit refined.md manually' },
            { value: 'jobs',       name: 'Job refinements — manage per-job curation plans' },
            { value: 'rerun',      name: 'Re-run refinement with Claude' },
          ],
        },
      ]) as { action: string };

      if (action === 'skip') return;

      if (action === 'consultant') {
        await runConsultantReview(existing.profile, existing.session, profileDir);
        return;
      }

      if (action === 'polish') {
        await applyExpertPolish(existing.profile, existing.session, profileDir);
        return;
      }

      if (action === 'prompt') {
        await applyDirectPrompt(existing.profile, existing.session, profileDir);
        return;
      }

      if (action === 'edit') {
        await openInEditor(refinedMdPath(profileDir));
        const originalProfile = await loadSource(profileDir);
        const updatedProfile = await markdownToProfile(refinedMdPath(profileDir), originalProfile);
        await saveRefined({ profile: updatedProfile, session: existing.session }, profileDir);
        console.log(`\n${c.ok} ${c.success('refined.json updated from edited markdown.')}`);
        return;
      }

      if (action === 'jobs') {
        await runJobRefinements(existing.profile, existing.session, profileDir);
        return;
      }
      // fall through to re-run
    } else {
      console.log(`\n${c.warn} ${c.warning('Source profile has changed since the last refinement.')}`);
      const { rerun } = await inquirer.prompt([
        { type: 'confirm', name: 'rerun', message: 'Re-run refinement with updated source?', default: true },
      ]) as { rerun: boolean };
      if (!rerun) return;
    }
  }

  // Load source and run refinement
  const source = await loadSource(profileDir);
  console.log(`\n${c.ok} Loaded source: ${c.value(source.contact.name.value)} ${c.muted(`· ${source.positions.length} positions · ${source.skills.length} skills`)}\n`);

  // Step 1: Generate questions
  console.log(c.muted('Analyzing profile with Claude...'));
  const profileText = profileToRefineText(source);
  const { questions } = await callWithTool<QuestionsOutput>(
    REFINE_QUESTIONS_SYSTEM,
    `Here is the candidate's profile:\n\n${profileText}`,
    questionsToolSchema,
  );

  if (questions.length === 0) {
    console.log(`\n${c.ok} ${c.success("Claude found no gaps — your profile looks complete!")}`);
    const session: RefinementSession = {
      conductedAt: new Date().toISOString(),
      sourceHash: currentHash,
      questions: [],
      answers: {},
    };
    await saveRefined({ profile: source, session }, profileDir);
    await profileToMarkdown(source, refinedMdPath(profileDir));
    console.log(`\n${c.ok} ${c.success('Refined data saved')} ${c.muted('(no changes)')}`);
    console.log(`   ${c.path(refinedJsonPath(profileDir))}`);
    return;
  }

  // Step 2: Collect answers
  const answers = await collectAnswers(questions);

  if (Object.keys(answers).length === 0) {
    console.log(`\n${c.muted('No answers provided — saving source as refined data without changes.')}`);
    const session: RefinementSession = {
      conductedAt: new Date().toISOString(),
      sourceHash: currentHash,
      questions,
      answers: {},
    };
    await saveRefined({ profile: source, session }, profileDir);
    await profileToMarkdown(source, refinedMdPath(profileDir));
    return;
  }

  // Step 3: Generate refinements
  console.log(c.muted('Generating improvements with Claude...'));
  const rawRefinements = await callWithTool<RefinementsOutput>(
    REFINE_APPLY_SYSTEM,
    `${profileText}\n\n${buildQAContext(questions, answers)}`,
    refinementsToolSchema,
  );

  // Step 4: Review and confirm
  const proposedProfile = applyRefinements(source, rawRefinements);
  const finalProfile = await reviewRefinements(source, proposedProfile);

  // Step 5: Save
  const session: RefinementSession = {
    conductedAt: new Date().toISOString(),
    sourceHash: currentHash,
    questions,
    answers,
  };
  await saveRefined({ profile: finalProfile, session }, profileDir);
  await profileToMarkdown(finalProfile, refinedMdPath(profileDir));

  console.log(`\n${c.ok} ${c.success('Refined data saved:')}`);
  console.log(`   ${c.path(refinedJsonPath(profileDir))}`);
  console.log(`   ${c.path(refinedMdPath(profileDir))}`);

  // Auto-run consultant review after refinement
  await runConsultantReview(finalProfile, session, profileDir);

  const { followUp } = await inquirer.prompt([
    {
      type: 'list',
      name: 'followUp',
      message: 'What next?',
      choices: [
        { value: 'done',       name: 'Done' },
        { value: 'polish',     name: 'Expert polish — have a pro improve the writing' },
        { value: 'prompt',     name: 'Prompt — make a targeted change' },
        { value: 'consultant', name: 'Consultant review again' },
        { value: 'jobs',       name: 'Job refinements — manage per-job curation plans' },
      ],
    },
  ]) as { followUp: string };

  if (followUp === 'polish') {
    const saved = await loadRefined(profileDir);
    await applyExpertPolish(saved.profile, saved.session, profileDir);
  } else if (followUp === 'prompt') {
    const saved = await loadRefined(profileDir);
    await applyDirectPrompt(saved.profile, saved.session, profileDir);
  } else if (followUp === 'consultant') {
    const saved = await loadRefined(profileDir);
    await runConsultantReview(saved.profile, saved.session, profileDir);
  } else if (followUp === 'jobs') {
    const saved = await loadRefined(profileDir);
    await runJobRefinements(saved.profile, saved.session, profileDir);
  }

  console.log(`\n${c.tip(`Tip: edit ${refinedMdPath(profileDir)} to make manual changes, then choose "Edit" on next run.`)}`);
}
