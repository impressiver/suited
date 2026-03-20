import { clearLinkedInSession } from '../ingestion/linkedin-scraper.ts';
import type { Profile } from '../profile/schema.ts';
import { sourceJsonPath, sourceMdPath } from '../profile/serializer.ts';
import { importProfileFromInput } from '../services/importProfile.ts';
import { c } from '../utils/colors.ts';
import { ensureContactDetails } from '../utils/contact.ts';

export interface ImportOptions {
  input?: string;
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
  /** Suppress next-step tip when running as part of the full flow */
  flow?: boolean;
}

export async function runImport(options: ImportOptions): Promise<void> {
  const profileDir = options.profileDir ?? 'output';

  if (options.clearSession) {
    await clearLinkedInSession();
  }

  let input = options.input;

  if (!input) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: 'LinkedIn profile URL, export ZIP/directory path, or paste profile text:',
        validate: (v: string) => v.trim().length > 0 || 'Please provide input',
      },
    ]);
    input = (answers as { input: string }).input;
  }

  console.log(c.muted("\nHmm, let me see what you've got..."));
  const { detected, profile } = await importProfileFromInput({
    input,
    profileDir,
    headed: options.headed,
    onPhase: (msg) => {
      console.log(c.muted(`  ${msg}`));
    },
  });
  console.log(`  ${c.arr} ${c.value(detected.kind)}`);
  printSummary(profile);

  console.log(`\n${c.ok} ${c.success('Profile imported and saved.')}`);
  console.log(`   ${c.path(sourceJsonPath(profileDir))}`);
  console.log(`   ${c.path(sourceMdPath(profileDir))}`);

  // Collect any missing contact details (email, phone, headline, LinkedIn)
  const { default: inquirer } = await import('inquirer');
  await ensureContactDetails(profile, profileDir, inquirer);

  if (!options.flow) {
    console.log(
      `\n  ${c.star} ${c.tip("Next: run 'resume refine' — Claude will fill gaps and sharpen your bullets.")}`,
    );
  }
}

function printSummary(profile: Profile): void {
  console.log(
    `\n  ${c.ok} ${c.value(profile.contact.name.value)} — ${c.cheeky('nice to meet you.')}`,
  );
  const stats = [
    `${profile.positions.length} positions`,
    `${profile.education.length} education`,
    `${profile.skills.length} skills`,
    ...(profile.projects.length ? [`${profile.projects.length} projects`] : []),
    ...(profile.certifications.length ? [`${profile.certifications.length} certs`] : []),
    ...(profile.volunteer.length ? [`${profile.volunteer.length} volunteer`] : []),
  ];
  console.log(`  ${c.muted(stats.join('  ·  '))}`);
}
