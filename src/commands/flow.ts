/**
 * Full pipeline: import → refine → generate
 *
 * Runs when `resume` is invoked without a subcommand.
 * Each step is skipped if its output already exists and the upstream data
 * has not changed. If source data changes, downstream outputs are cleared
 * so stale refined/generation data is never used.
 */

import {
  loadSource, hashSource, clearRefined, clearGenerationConfig,
  sourceJsonPath, refinedJsonPath,
} from '../profile/serializer.js';
import { runImport } from './import.js';
import { runRefine } from './refine.js';
import { runGenerate } from './generate.js';
import { fileExists } from '../utils/fs.js';
import { c } from '../utils/colors.js';

export interface FlowOptions {
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
}

export async function runFlow(options: FlowOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  console.log('\n' + c.header('══ Resume Builder ══') + '\n');

  // -------------------------------------------------------------------------
  // Step 1: Import
  // -------------------------------------------------------------------------
  console.log(c.step('Step 1 of 3 — Import') + '\n');

  let sourceChanged = false;

  if (await fileExists(sourceJsonPath(profileDir))) {
    const existing = await loadSource(profileDir);
    const importedDate = new Date(existing.updatedAt).toLocaleDateString();
    console.log(`  ${c.ok} ${c.value(existing.contact.name.value)} ${c.muted(`(imported ${importedDate})`)}`);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Use existing source data or import new?',
        choices: [
          { value: 'use', name: 'Use existing' },
          { value: 'import', name: 'Import new data' },
        ],
      },
    ]) as { action: string };

    if (action === 'import') {
      const prevHash = await hashSource(profileDir);
      await runImport({ profileDir, headed: options.headed, clearSession: options.clearSession, flow: true });
      const newHash = await hashSource(profileDir);
      sourceChanged = prevHash !== newHash;
      if (sourceChanged) {
        console.log(`\n  ${c.warn} ${c.warning('Source data changed — clearing downstream outputs.')}`);
        await clearRefined(profileDir);
        await clearGenerationConfig(profileDir);
      }
    }
  } else {
    await runImport({ profileDir, headed: options.headed, clearSession: options.clearSession, flow: true });
    sourceChanged = true;
  }

  // -------------------------------------------------------------------------
  // Step 2: Refine
  // -------------------------------------------------------------------------
  console.log('\n' + c.step('Step 2 of 3 — Refine') + '\n');
  await runRefine({ profileDir });

  // -------------------------------------------------------------------------
  // Step 3: Generate
  // -------------------------------------------------------------------------
  console.log('\n' + c.step('Step 3 of 3 — Generate') + '\n');
  await runGenerate({ profileDir });
}
