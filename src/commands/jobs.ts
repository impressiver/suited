import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SavedJob } from '../profile/schema.ts';
import { deleteJob, loadJobRefinement, loadJobs, saveJob } from '../profile/serializer.ts';
import { c } from '../utils/colors.ts';
import { fileExists } from '../utils/fs.ts';
import { isUserExit } from '../utils/user-exit.ts';

export interface JobsOptions {
  profileDir?: string;
}

async function viewJob(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  job: SavedJob,
  profileDir: string,
): Promise<boolean> {
  const refinement = await loadJobRefinement(profileDir, job.id);
  const savedDate = new Date(job.savedAt).toLocaleDateString();
  const preview = job.text.length > 300 ? `${job.text.slice(0, 300)}…` : job.text;

  console.log(`\n  ${c.value(`${job.title} @ ${job.company}`)}`);
  console.log(`  ${c.label('Saved:')} ${savedDate}`);
  if (refinement) {
    console.log(`  ${c.label('Prepared:')} ${new Date(refinement.createdAt).toLocaleDateString()}`);
  } else {
    console.log(`  ${c.label('Prepared:')} ${c.muted('not yet')}`);
  }
  console.log(`\n${c.muted(preview)}\n`);

  const { action } = (await inquirer.prompt([
    {
      type: 'list',
      loop: false,
      name: 'action',
      message: 'Job options:',
      choices: [
        { value: 'delete', name: c.error('Delete this job') },
        { value: 'back', name: c.muted('← Back') },
      ],
    },
  ])) as { action: string };

  if (action === 'delete') {
    const { confirm } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Delete "${job.title} @ ${job.company}"?`,
        default: false,
      },
    ])) as { confirm: boolean };

    if (confirm) {
      await deleteJob(job.id, profileDir);
      console.log(`${c.ok} ${c.success('Job deleted.')}`);
      return true; // was deleted
    }
  }

  return false;
}

export async function runJobs(options: JobsOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  while (true) {
    const jobs = await loadJobs(profileDir);

    console.log(`\n${c.header('── Job Descriptions ──')}\n`);

    if (jobs.length === 0) {
      console.log(`  ${c.muted('No saved jobs yet.')}\n`);
    }

    // Build list with preparation status
    const refinementStatuses = await Promise.all(
      jobs.map(async (j) => {
        const r = await loadJobRefinement(profileDir, j.id);
        return { job: j, hasPrepared: !!r, preparedDate: r?.createdAt };
      }),
    );

    const jobChoices = refinementStatuses.map(({ job, hasPrepared, preparedDate }) => {
      const status = hasPrepared
        ? `${c.ok} ${c.muted(`prepared ${new Date(preparedDate!).toLocaleDateString()}`)}`
        : c.muted('not prepared');
      return {
        name: `${job.title} @ ${job.company}  ${status}`,
        value: job.id,
      };
    });

    let action: string;
    try {
      const ans = (await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'action',
          message: 'Jobs:',
          choices: [
            ...jobChoices,
            { name: '+ Add new job', value: '__add__' },
            ...(jobs.length > 0 ? [{ name: '− Delete job(s)', value: '__delete__' }] : []),
            { name: c.muted('← Back'), value: '__back__' },
          ],
        },
      ])) as { action: string };
      action = ans.action;
    } catch (err) {
      if (isUserExit(err)) return;
      throw err;
    }

    if (action === '__back__') return;

    if (action === '__add__') {
      // Ask for source type
      const { source } = (await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'source',
          message: 'How would you like to provide the job description?',
          choices: [
            { value: 'paste', name: 'Paste / type text' },
            { value: 'file', name: 'File path' },
          ],
        },
      ])) as { source: string };

      let text = '';

      if (source === 'file') {
        const { filePath } = (await inquirer.prompt([
          { type: 'input', name: 'filePath', message: 'File path:' },
        ])) as { filePath: string };
        if (!(await fileExists(filePath.trim()))) {
          console.log(c.error(`File not found: ${filePath}`));
          continue;
        }
        text = await readFile(filePath.trim(), 'utf-8');
      } else {
        console.log(
          c.muted(
            '  Paste the job description below. Enter a blank line followed by END to finish.',
          ),
        );
        const lines: string[] = [];
        while (true) {
          const { line } = (await inquirer.prompt([
            { type: 'input', name: 'line', message: '>' },
          ])) as { line: string };
          if (line.trim() === 'END') break;
          lines.push(line);
        }
        text = lines.join('\n').trim();
      }

      if (!text) {
        console.log(c.muted('  No text provided. Cancelled.'));
        continue;
      }

      const { company } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'company',
          message: 'Company name (or leave blank to use placeholder):',
          default: 'Unknown Company',
        },
      ])) as { company: string };
      const { title } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'Job title (or leave blank to use placeholder):',
          default: 'Unknown Role',
        },
      ])) as { title: string };

      const textHash = createHash('sha256').update(text).digest('hex');
      const newJob: SavedJob = {
        id: `job-${Date.now()}`,
        company: company.trim() || 'Unknown Company',
        title: title.trim() || 'Unknown Role',
        savedAt: new Date().toISOString(),
        text,
        textHash,
      };

      await saveJob(newJob, profileDir);
      console.log(`${c.ok} ${c.success('Job saved.')}`);
      continue;
    }

    if (action === '__delete__') {
      const currentJobs = await loadJobs(profileDir);
      const { toDelete } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toDelete',
          message: 'Select jobs to delete:',
          choices: currentJobs.map((j) => ({
            name: `${j.title} @ ${j.company}`,
            value: j.id,
          })),
        },
      ])) as { toDelete: string[] };

      if (toDelete.length > 0) {
        for (const id of toDelete) {
          await deleteJob(id, profileDir);
        }
        console.log(`${c.ok} ${c.success(`Deleted ${toDelete.length} job(s).`)}`);
      }
      continue;
    }

    // Viewing a specific job
    const job = jobs.find((j) => j.id === action);
    if (job) {
      await viewJob(inquirer, job, profileDir);
    }
  }
}
