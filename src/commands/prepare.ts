import type { JobEvaluation } from '../claude/prompts/consultant.ts';
import {
  applyJobFeedback,
  enrichFindingsWithUserInput,
  evaluateForJob,
  printJobEvaluation,
} from '../generate/consultant.ts';
import { buildRefMapForProfile } from '../generate/curator.ts';
import { assembleResumeDocument, getFlairInfo } from '../generate/resume-builder.ts';
import type { CurationPlan, Profile, ResumeDocument } from '../profile/schema.ts';
import { loadActiveProfile, loadJobRefinement, loadJobs } from '../profile/serializer.ts';
import { runJobRefinementPipeline } from '../services/jobRefinement.ts';
import { c } from '../utils/colors.ts';
import { createSpinner } from '../utils/spinner.ts';
import { isUserExit } from '../utils/user-exit.ts';

export interface PrepareOptions {
  profileDir?: string;
}

// ---------------------------------------------------------------------------
// Bullet preview
// ---------------------------------------------------------------------------

function printCurationPreview(
  profile: Profile,
  plan: CurationPlan,
  company: string,
  title: string,
): void {
  const _selectedSet = new Set(plan.selectedPositions.map((p) => p.positionId));
  const allPositions = profile.positions;

  console.log(`\n  ${c.header(`Curated for: ${title} @ ${company}`)}\n`);

  // Experience section
  const totalPositions = allPositions.length;
  const selectedPositions = plan.selectedPositions.length;
  console.log(
    `  ${c.label('Experience')}  ${c.value(`(${selectedPositions} of ${totalPositions} selected)`)}`,
  );

  for (const pos of allPositions) {
    const selected = plan.selectedPositions.find((sp) => sp.positionId === pos.id);
    const start = pos.startDate.value.slice(0, 4);
    const end = pos.endDate ? pos.endDate.value.slice(0, 4) : 'Present';
    const dateRange = `${start}–${end}`;

    if (selected) {
      console.log(
        `    ${c.ok} ${c.value(pos.title.value)} @ ${pos.company.value}  ${c.muted(dateRange)}`,
      );
      // Show bullet text for selected bullets
      for (const bulletRef of selected.bulletRefs) {
        // bulletRef is like "b:pos-0:2"
        const parts = bulletRef.split(':');
        if (parts.length === 3) {
          const idx = parseInt(parts[2], 10);
          const bullet = pos.bullets[idx];
          if (bullet) {
            const preview =
              bullet.value.length > 90 ? `${bullet.value.slice(0, 90)}…` : bullet.value;
            console.log(`        ${c.muted('·')} ${preview}`);
          }
        }
      }
    } else {
      console.log(
        `    ${c.muted('–')} ${c.muted(`${pos.title.value} @ ${pos.company.value}  ${dateRange}  (excluded)`)}`,
      );
    }
  }

  // Skills
  const selectedSkills = plan.selectedSkillIds
    .map((id) => profile.skills.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => s?.name.value);
  console.log(`\n  ${c.label('Skills')}  ${c.value(`(${selectedSkills.length})`)}`);
  if (selectedSkills.length > 0) {
    console.log(`    ${selectedSkills.join(', ')}`);
  }

  // Education
  const selectedEdu = plan.selectedEducationIds
    .map((id) => profile.education.find((e) => e.id === id))
    .filter(Boolean);
  console.log(`\n  ${c.label('Education')}  ${c.value(`(${selectedEdu.length})`)}`);
  for (const edu of selectedEdu) {
    const parts = [edu?.degree?.value, edu?.fieldOfStudy?.value].filter(Boolean);
    const label =
      parts.length > 0
        ? `${parts.join(' in ')} — ${edu?.institution.value}`
        : edu?.institution.value;
    console.log(`    ${label}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function runPrepare(options: PrepareOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  const jobs = await loadJobs(profileDir);

  if (jobs.length === 0) {
    console.log(
      `\n  ${c.muted('No saved job descriptions. Use "Manage jobs" to add some first.')}`,
    );
    return;
  }

  const profile = await loadActiveProfile(profileDir);

  // Build list with preparation status
  const refinementStatuses = await Promise.all(
    jobs.map(async (j) => {
      const r = await loadJobRefinement(profileDir, j.id);
      return { job: j, refinement: r };
    }),
  );

  while (true) {
    console.log(`\n${c.header('── Prepare for a Job ──')}\n`);

    const jobChoices = refinementStatuses.map(({ job, refinement }) => {
      const status = refinement
        ? `${c.ok} ${c.muted(`prepared ${new Date(refinement.createdAt).toLocaleDateString()}`)}`
        : c.muted('not prepared');
      return {
        name: `${job.title} @ ${job.company}  ${status}`,
        value: job.id,
      };
    });

    let jobId: string;
    try {
      const ans = (await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'jobId',
          message: 'Select a job to prepare for:',
          choices: [...jobChoices, { name: c.muted('← Back'), value: '__back__' }],
        },
      ])) as { jobId: string };
      jobId = ans.jobId;
    } catch (err) {
      if (isUserExit(err)) return;
      throw err;
    }

    if (jobId === '__back__') return;

    const statusEntry = refinementStatuses.find((s) => s.job.id === jobId)!;
    const job = statusEntry.job;
    let refinement = statusEntry.refinement;

    if (!refinement) {
      // Auto-run curation
      console.log(`\nPreparing for ${c.value(`${job.title} @ ${job.company}`)}...`);
      try {
        refinement = await runJobRefinementPipeline(profileDir, job, null);
        statusEntry.refinement = refinement;
      } catch (err) {
        console.error(`\n${c.fail} ${c.error((err as Error).message)}`);
        continue;
      }
      printCurationPreview(profile, refinement.plan, job.company, job.title);
      console.log(`${c.ok} ${c.success('Preparation saved.')}`);
      continue;
    }

    // Refinement exists — show menu
    while (true) {
      let action: string;
      try {
        const ans = (await inquirer.prompt([
          {
            type: 'list',
            loop: false,
            name: 'action',
            message: `${job.title} @ ${job.company}:`,
            choices: [
              { value: 'view', name: 'View preparation' },
              { value: 'recurate', name: '↻ Re-run curation' },
              { value: 'feedback', name: 'Run professional feedback' },
              { value: 'back', name: c.muted('← Back') },
            ],
          },
        ])) as { action: string };
        action = ans.action;
      } catch (err) {
        if (isUserExit(err)) break;
        throw err;
      }

      if (action === 'back') break;

      if (action === 'view') {
        printCurationPreview(profile, refinement.plan, job.company, job.title);
        continue;
      }

      if (action === 'recurate') {
        console.log(`\nRe-curating for ${c.value(`${job.title} @ ${job.company}`)}...`);
        try {
          refinement = await runJobRefinementPipeline(profileDir, job, refinement);
          statusEntry.refinement = refinement;
        } catch (err) {
          console.error(`\n${c.fail} ${c.error((err as Error).message)}`);
          continue;
        }
        printCurationPreview(profile, refinement.plan, job.company, job.title);
        console.log(`${c.ok} ${c.success('Curation updated.')}`);
        continue;
      }

      if (action === 'feedback') {
        // Build a resume document from the current plan
        const refMap = buildRefMapForProfile(profile);
        const { effectiveFlair } = getFlairInfo(3, refinement.jobAnalysis.industry);

        let doc: ResumeDocument;
        try {
          doc = assembleResumeDocument(
            profile,
            refinement.plan,
            refMap,
            effectiveFlair,
            refinement.jobAnalysis.industry,
            job.title,
            job.company,
          );
        } catch (err) {
          console.error(
            `\n${c.fail} ${c.error(`Could not build resume document: ${(err as Error).message}`)}`,
          );
          continue;
        }

        // Run evaluation
        const evalSpinner = createSpinner('Running professional feedback...');
        let evaluation: JobEvaluation;
        try {
          evaluation = await evaluateForJob(doc, refinement.jobAnalysis);
          evalSpinner.succeed(`${c.ok} Feedback complete.`);
        } catch (err) {
          evalSpinner.stop();
          console.error(`\n${c.fail} ${c.error(`Feedback failed: ${(err as Error).message}`)}`);
          continue;
        }

        printJobEvaluation(evaluation);

        if (evaluation.gaps.length === 0) {
          console.log(c.muted('  No gaps found. Nothing to apply.'));
          continue;
        }

        const { feedbackAction } = (await inquirer.prompt([
          {
            type: 'list',
            loop: false,
            name: 'feedbackAction',
            message: 'Apply feedback?',
            choices: [
              { value: 'skip', name: 'Skip' },
              { value: 'apply', name: 'Apply feedback to document' },
            ],
          },
        ])) as { feedbackAction: string };

        if (feedbackAction === 'skip') continue;

        // Enrich with user input then apply
        const enrichedGaps = await enrichFindingsWithUserInput(
          evaluation.gaps,
          inquirer,
          doc.positions.map((p) => `${p.title} at ${p.company}`).join(', '),
        );

        const applySpinner = createSpinner('Applying feedback...');
        try {
          await applyJobFeedback(doc, refinement.jobAnalysis, enrichedGaps);
          applySpinner.succeed(`${c.ok} Feedback applied.`);
        } catch (err) {
          applySpinner.stop();
          console.error(
            `\n${c.fail} ${c.error(`Could not apply feedback: ${(err as Error).message}`)}`,
          );
        }
      }
    }
  }
}
