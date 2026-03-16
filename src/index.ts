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
import { runImport } from './commands/import.js';
import { runRefine } from './commands/refine.js';
import { runGenerate } from './commands/generate.js';
import { runValidate } from './commands/validate.js';
import { runFlow } from './commands/flow.js';

const program = new Command();

program
  .name('resume')
  .description('Generate tailored, factually-accurate resumes from LinkedIn data')
  .version('1.0.0');

program
  .command('import [input]')
  .description('Import a LinkedIn profile (URL, export ZIP/directory, or pasted text) → source data')
  .option('--profile-dir <dir>', 'Directory to store profile files', 'output')
  .option('--headed', 'Show browser window during scrape (use for 2FA or CAPTCHA)')
  .option('--clear-session', 'Clear saved LinkedIn session and re-authenticate')
  .action(async (
    input: string | undefined,
    opts: { profileDir?: string; headed?: boolean; clearSession?: boolean },
  ) => {
    try {
      await runImport({ input, profileDir: opts.profileDir, headed: opts.headed, clearSession: opts.clearSession });
    } catch (err) {
      console.error(`\n✗ Import failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('refine')
  .description('Improve profile with Claude Q&A → refined data (skips if already done)')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      await runRefine({ profileDir: opts.profileDir });
    } catch (err) {
      console.error(`\n✗ Refine failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate a PDF resume from refined data (skips prompts if settings saved)')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .option('--output <dir>', 'Output directory for PDFs')
  .option('--jd <text|path>', 'Job description text or file path (skips prompt)')
  .option('--flair <1-5>', 'Flair level (skips prompt)')
  .action(async (opts: { profileDir?: string; output?: string; jd?: string; flair?: string }) => {
    try {
      await runGenerate(opts);
    } catch (err) {
      console.error(`\n✗ Generate failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

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

// Default action: run the full pipeline when no subcommand is given
program.action(async (opts: { profileDir?: string; headed?: boolean; clearSession?: boolean }) => {
  try {
    await runFlow({
      profileDir: opts.profileDir,
      headed: opts.headed,
      clearSession: opts.clearSession,
    });
  } catch (err) {
    console.error(`\n✗ ${(err as Error).message}`);
    process.exit(1);
  }
});

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
