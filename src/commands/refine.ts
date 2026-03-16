import {
  loadSource, saveRefined, loadRefined, hashSource,
  refinedJsonPath, refinedMdPath, sourceJsonPath,
} from '../profile/serializer.js';
import { profileToMarkdown, markdownToProfile } from '../profile/markdown.js';
import { callWithTool } from '../claude/client.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import {
  profileToRefineText, REFINE_QUESTIONS_SYSTEM, questionsToolSchema,
  REFINE_APPLY_SYSTEM, refinementsToolSchema, buildQAContext,
  DIRECT_EDIT_SYSTEM,
} from '../claude/prompts/refine.js';
import {
  Profile, Sourced, RefinementQuestion, RefinementSession,
} from '../profile/schema.js';
import { c } from '../utils/colors.js';

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

  if (refinements.addedSkills?.length) {
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
    console.log(`  ${c.muted(`[${q.context}]`)}`);
    const result = await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message: q.question + (q.optional ? ' (optional)' : ''),
      },
    ]);
    const answer = (result as { answer: string }).answer.trim();
    if (answer) answers[q.id] = answer;
    console.log();
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

  if (!changedPositions.length && !summaryChanged && !addedSkills.length) {
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
  if (addedSkills.length > 0) {
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

  if (addedSkills.length > 0) {
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
            { value: 'skip',   name: 'Skip — use existing refinement' },
            { value: 'prompt', name: 'Prompt — tell Claude what to change' },
            { value: 'edit',   name: 'Edit refined.md manually' },
            { value: 'rerun',  name: 'Re-run refinement with Claude' },
          ],
        },
      ]) as { action: string };

      if (action === 'skip') return;

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
  console.log(`\n${c.tip(`Tip: edit ${refinedMdPath(profileDir)} to make manual changes, then choose "Edit" on next run.`)}`);
}
