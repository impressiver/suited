import {
  loadSource, sourceJsonPath, refinedJsonPath, loadGenerationConfig,
} from '../profile/serializer.js';
import { getFlairInfo } from '../generate/resume-builder.js';
import { runImport } from './import.js';
import { runGenerate } from './generate.js';
import { runValidate } from './validate.js';
import { runRefine } from './refine.js';
import { runContact } from './contact.js';
import { runJobs } from './jobs.js';
import { runPrepare } from './prepare.js';
import { fileExists } from '../utils/fs.js';
import { c, banner, randomTagline } from '../utils/colors.js';
import { isUserExit } from '../utils/user-exit.js';
import type { FlowOptions } from './flow.js';

export async function runDashboard(options: FlowOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  while (true) {
    console.log('\n' + banner('Resume Builder', randomTagline()) + '\n');

    const hasSource = await fileExists(sourceJsonPath(profileDir));
    const hasRefined = await fileExists(refinedJsonPath(profileDir));

    if (hasSource) {
      const source = await loadSource(profileDir);
      const refinedMark = hasRefined
        ? `  ${c.ok} ${c.success('refined')}`
        : `  ${c.warn} ${c.warning('not refined')}`;
      console.log(
        `  ${c.label('Profile:')}   ${c.value(source.contact.name.value)}` +
        `  ${c.muted('·')}  ${c.highlight(String(source.positions.length))} ${c.muted('positions')}` +
        `  ${c.muted('·')}  ${c.highlight(String(source.skills.length))} ${c.muted('skills')}` +
        refinedMark,
      );

      const config = await loadGenerationConfig(profileDir);
      if (config && (config.company || config.jobTitle)) {
        const target = config.company
          ? `${config.company} – ${config.jobTitle}`
          : config.jobTitle;
        const date = new Date(config.updatedAt).toLocaleDateString();
        let template = config.resolvedTemplate ?? config.templateOverride;
        if (!template) {
          const { effectiveTemplate } = getFlairInfo(
            config.flair,
            config.jobAnalysis?.industry ?? 'general',
          );
          template = effectiveTemplate;
        }
        console.log(`  ${c.label('Last PDF:')} ${c.accent(target!)}  ${c.muted(`(${date}, ${template})`)}`);
      }

      if (!hasRefined) {
        console.log(`\n  ${c.star} ${c.tip("Pro tip: choose 'Refine profile' first — Claude will fill in the gaps.")}`);
      }
    }

    const choices = hasSource
      ? [
          { value: 'import',   name: `1. Import profile data    ${c.muted('(LinkedIn URL, ZIP export, or paste)')}` },
          { value: 'refine',   name: `2. Refine profile          ${c.muted('(Q&A, pro feedback, manual editing)')}` },
          { value: 'jobs',     name: `3. Manage jobs             ${c.muted('(add, view, delete job descriptions)')}` },
          { value: 'contact',  name: `4. Contact info            ${c.muted('(view and edit contact details)')}` },
          { value: 'prepare',  name: `5. Prepare for a job       ${c.muted('(curate profile for a specific job rec)')}` },
          { value: 'generate', name: `6. ${c.highlight('Generate resume')}         ${c.muted('(export PDF)')}` },
          { value: 'exit',     name: c.muted('Exit') },
        ]
      : [
          { value: 'import', name: `Import profile data  ${c.muted('(LinkedIn URL, ZIP export, or paste)')}` },
          { value: 'exit',   name: c.muted('Exit') },
        ];

    let action: string;
    try {
      const answer = await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'action',
          message: 'What would you like to do?',
          choices,
        },
      ]) as { action: string };
      action = answer.action;
    } catch (err) {
      // Ctrl+C — clean exit
      if (isUserExit(err)) { console.log(''); break; }
      throw err;
    }

    if (action === 'exit') {
      break;
    } else if (action === 'import') {
      try {
        await runImport({
          profileDir,
          headed:       options.headed,
          clearSession: options.clearSession,
        });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Import failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'generate') {
      try {
        await runGenerate({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Generate failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'refine') {
      try {
        await runRefine({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Refine failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'contact') {
      try {
        await runContact({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Contact failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'jobs') {
      try {
        await runJobs({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Jobs failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'prepare') {
      try {
        await runPrepare({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Prepare failed: ${(err as Error).message}`)}`);
      }
    } else if (action === 'validate') {
      try {
        await runValidate({ profileDir });
      } catch (err) {
        if (!isUserExit(err)) console.error(`\n${c.fail} ${c.error(`Validate failed: ${(err as Error).message}`)}`);
      }
    }
  }
}
