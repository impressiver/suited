#!/usr/bin/env node
/**
 * Resume Builder CLI
 * Usage:
 *   resume import [input]
 *   resume refine
 *   resume generate
 *   resume validate
 */

import 'dotenv/config';
import { Command } from 'commander';
import { runContact } from './commands/contact.ts';
import { runFlow } from './commands/flow.ts';
import { runGenerate } from './commands/generate.ts';
import { runImport } from './commands/import.ts';
import { runImprove } from './commands/improve.ts';
import { runJobs } from './commands/jobs.ts';
import { runPrepare } from './commands/prepare.ts';
import { runRefine } from './commands/refine.ts';
import { runValidate } from './commands/validate.ts';
import {
  listGlobalRefinementHistory,
  restoreGlobalRefinedSnapshot,
} from './services/refinementHistory.ts';
import { withNoHistorySnapshotFlag } from './utils/refinementHistoryEnv.ts';
import { PACKAGE_VERSION } from './version.ts';

const program = new Command();

program
  .name('suited')
  .description('Generate tailored, factually-accurate resumes from LinkedIn data')
  .version(PACKAGE_VERSION);

program
  .command('import [input]')
  .description(
    'Import a LinkedIn profile (URL, export ZIP/directory, or pasted text) → source data',
  )
  .option('--profile-dir <dir>', 'Directory to store profile files', 'output')
  .option('--headed', 'Show browser window during scrape (use for 2FA or CAPTCHA)')
  .option('--clear-session', 'Clear saved LinkedIn session and re-authenticate')
  .action(
    async (
      input: string | undefined,
      opts: { profileDir?: string; headed?: boolean; clearSession?: boolean },
    ) => {
      try {
        await runImport({
          input,
          profileDir: opts.profileDir,
          headed: opts.headed,
          clearSession: opts.clearSession,
        });
      } catch (err) {
        console.error(`\n✗ Import failed: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

const refineCmd = new Command('refine').description(
  'Improve profile with Claude Q&A → refined data (skips if already done)',
);

refineCmd
  .command('run', { isDefault: true, hidden: true })
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option(
    '--no-history-snapshot',
    'Do not append refined-history/ snapshots when saving refined.json (this command)',
  )
  .action(async (opts: { profileDir?: string; noHistorySnapshot?: boolean }) => {
    try {
      await withNoHistorySnapshotFlag(opts.noHistorySnapshot, async () => {
        await runRefine({ profileDir: opts.profileDir });
      });
    } catch (err) {
      console.error(`\n✗ Refine failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

const refineHistoryCmd = new Command('history').description(
  'List or restore durable snapshots of refined.json (see specs/refinement-history.md)',
);

refineHistoryCmd
  .command('list', { isDefault: true })
  .description('List refinement snapshots (most recent first)')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      const profileDir = opts.profileDir ?? 'output';
      const { entries, warnings } = await listGlobalRefinementHistory(profileDir);
      for (const w of warnings) {
        console.warn(w);
      }
      if (entries.length === 0) {
        console.log('No refinement snapshots.');
        return;
      }
      console.log('id\tsavedAt\treason');
      for (const e of entries) {
        console.log(`${e.id}\t${e.savedAt}\t${e.reason}`);
      }
    } catch (err) {
      console.error(`\n✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

refineHistoryCmd
  .command('restore')
  .description('Restore global refined profile from a snapshot id (from list)')
  .argument('<id>', 'Snapshot id')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option(
    '--replace-head-only',
    'Do not snapshot current refined before restore (cannot undo the pre-restore state via history)',
  )
  .action(async (id: string, opts: { profileDir?: string; replaceHeadOnly?: boolean }) => {
    try {
      const profileDir = opts.profileDir ?? 'output';
      await restoreGlobalRefinedSnapshot(profileDir, id, {
        replaceHeadOnly: opts.replaceHeadOnly,
      });
      console.log(`Restored refinement snapshot ${id}.`);
    } catch (err) {
      console.error(`\n✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

refineCmd.addCommand(refineHistoryCmd);
program.addCommand(refineCmd);

program
  .command('generate')
  .description('Generate a PDF resume from refined data (skips prompts if settings saved)')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option('--output <dir>', 'Output directory for PDFs (default: ./resumes relative to cwd)')
  .option('--jd <text|path>', 'Job description text or file path (skips prompt)')
  .option('--flair <1-5>', 'Flair level (skips prompt)')
  .option(
    '--cover-letter',
    'When job-targeted, also export cover letter PDF after the resume PDF (non-empty draft)',
  )
  .option(
    '--cover-letter-only',
    'Skip resume; export only the cover letter PDF (requires --job-id)',
  )
  .option('--job-id <id>', 'Saved job id (required for --cover-letter-only)')
  .option(
    '--no-history-snapshot',
    'Do not append refined-history/ snapshots when saving refined.json (this command)',
  )
  .action(
    async (opts: {
      profileDir?: string;
      output?: string;
      jd?: string;
      flair?: string;
      coverLetter?: boolean;
      coverLetterOnly?: boolean;
      jobId?: string;
      noHistorySnapshot?: boolean;
    }) => {
      try {
        await withNoHistorySnapshotFlag(opts.noHistorySnapshot, async () => {
          await runGenerate(opts);
        });
      } catch (err) {
        console.error(`\n✗ Generate failed: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

program
  .command('validate')
  .description('Validate profile integrity and accuracy guard readiness')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      await runValidate(opts);
    } catch (err) {
      console.error(`\n✗ Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('improve')
  .description('Improve profile health: Q&A refinement, summary, bullet editing')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option(
    '--no-history-snapshot',
    'Do not append refined-history/ snapshots when saving refined.json (this command)',
  )
  .action(async (opts: { profileDir?: string; noHistorySnapshot?: boolean }) => {
    try {
      await withNoHistorySnapshotFlag(opts.noHistorySnapshot, async () => {
        await runImprove(opts);
      });
    } catch (err) {
      console.error(`\n✗ Improve failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('contact')
  .description('View and edit contact information')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option(
    '--no-history-snapshot',
    'Do not append refined-history/ snapshots when saving refined.json (this command)',
  )
  .action(async (opts: { profileDir?: string; noHistorySnapshot?: boolean }) => {
    try {
      await withNoHistorySnapshotFlag(opts.noHistorySnapshot, async () => {
        await runContact({ profileDir: opts.profileDir });
      });
    } catch (err) {
      console.error(`\n✗ Contact failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('jobs')
  .description('Manage saved job descriptions')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      await runJobs({ profileDir: opts.profileDir });
    } catch (err) {
      console.error(`\n✗ Jobs failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('prepare')
  .description('Prepare a curated resume for a specific job description')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      await runPrepare({ profileDir: opts.profileDir });
    } catch (err) {
      console.error(`\n✗ Prepare failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Default action: runFlow — Ink TUI when stdin+stdout are TTYs, else a non-interactive hint (see flow.ts)
program
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option('--headed', 'Show browser window during LinkedIn scrape (Import screen)')
  .option('--clear-session', 'Clear saved LinkedIn session (Import screen)')
  .option(
    '--no-history-snapshot',
    'Do not append refined-history/ snapshots when saving refined.json (this process)',
  )
  .action(
    async (opts: {
      profileDir?: string;
      headed?: boolean;
      clearSession?: boolean;
      noHistorySnapshot?: boolean;
    }) => {
      try {
        await runFlow({
          profileDir: opts.profileDir,
          headed: opts.headed,
          clearSession: opts.clearSession,
          noHistorySnapshot: opts.noHistorySnapshot,
        });
      } catch (err) {
        console.error(`\n✗ ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
