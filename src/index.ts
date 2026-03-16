#!/usr/bin/env node
/**
 * Resume Builder CLI
 * Usage:
 *   resume import [input]
 *   resume generate
 *   resume validate
 */

import 'dotenv/config';
import { Command } from 'commander';
import { runImport } from './commands/import.js';
import { runGenerate } from './commands/generate.js';
import { runValidate } from './commands/validate.js';

const program = new Command();

program
  .name('resume')
  .description('Generate tailored, factually-accurate resumes from LinkedIn data')
  .version('1.0.0');

program
  .command('import [input]')
  .description('Import a LinkedIn profile (export ZIP, export directory, or pasted text)')
  .option('--profile-dir <dir>', 'Directory to store profile files', 'output')
  .action(async (input: string | undefined, opts: { profileDir?: string }) => {
    try {
      await runImport({ input, profileDir: opts.profileDir });
    } catch (err) {
      console.error(`\n✗ Import failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate a tailored PDF resume for a specific job')
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
  .description('Validate the accuracy of a curation plan against the current profile')
  .option('--profile-dir <dir>', 'Directory containing profile files', 'output')
  .action(async (opts: { profileDir?: string }) => {
    try {
      await runValidate(opts);
    } catch (err) {
      console.error(`\n✗ Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
