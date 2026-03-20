import { markdownToProfile, profileToMarkdown } from '../profile/markdown.js';
import type { Profile } from '../profile/schema.js';
import {
  loadRefined,
  loadSource,
  refinedJsonPath,
  refinedMdPath,
  saveRefined,
  saveSource,
  sourceJsonPath,
} from '../profile/serializer.js';
import { computeHealthScore } from '../services/improve.js';
import { c, healthQuip, healthStars } from '../utils/colors.js';
import { ensureContactDetails } from '../utils/contact.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import { runRefine } from './refine.js';

export interface ImproveOptions {
  profileDir?: string;
}

export async function runImprove(options: ImproveOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  if (!(await fileExists(sourceJsonPath(profileDir)))) {
    console.log(`\n${c.fail} ${c.error("No profile found. Run 'resume import' first.")}`);
    return;
  }

  // Load active profile
  let profile = await loadActiveProfile(profileDir);

  // Collect any missing contact details upfront
  const anyMissing =
    !profile.contact.headline ||
    !profile.contact.email ||
    !profile.contact.phone ||
    !profile.contact.linkedin;
  if (anyMissing) {
    profile = await ensureContactDetails(profile, profileDir, inquirer);
  }

  let keepGoing = true;
  while (keepGoing) {
    const isRefined = await fileExists(refinedJsonPath(profileDir));
    printHealthScore(profile, isRefined);

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          {
            value: 'refine',
            name: 'Run Q&A refinement  (Claude asks targeted questions to improve content)',
          },
          { value: 'summary', name: 'Edit professional summary' },
          { value: 'edit', name: 'Edit profile in $EDITOR' },
          { value: 'back', name: 'Back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') {
      keepGoing = false;
    } else if (action === 'refine') {
      await runRefine({ profileDir });
      // Reload after refine
      profile = await loadActiveProfile(profileDir);
    } else if (action === 'summary') {
      const { summary } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'summary',
          message: 'Professional summary:',
          default: profile.summary?.value ?? '',
        },
      ])) as { summary: string };
      if (summary.trim()) {
        const now = new Date().toISOString();
        const updatedProfile: Profile = {
          ...profile,
          summary: { value: summary.trim(), source: { kind: 'user-edit', editedAt: now } },
        };
        const currentlyRefined = await fileExists(refinedJsonPath(profileDir));
        if (currentlyRefined) {
          const refined = await loadRefined(profileDir);
          await saveRefined({ ...refined, profile: updatedProfile }, profileDir);
        } else {
          await saveSource(updatedProfile, profileDir);
        }
        profile = updatedProfile;
        console.log(`  ${c.ok} ${c.success('Summary saved.')}`);
      }
    } else if (action === 'edit') {
      const mdPath = refinedMdPath(profileDir);
      if (!(await fileExists(mdPath))) {
        console.log(
          `  ${c.warn} ${c.warning('No refined.md found — run Q&A refinement first to create an editable profile.')}`,
        );
        continue;
      }
      await openInEditor(mdPath);
      const refined = await loadRefined(profileDir);
      const updatedProfile = await markdownToProfile(mdPath, refined.profile);
      await saveRefined({ profile: updatedProfile, session: refined.session }, profileDir);
      await profileToMarkdown(updatedProfile, mdPath);
      profile = updatedProfile;
      console.log('Refined data reloaded.');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadActiveProfile(profileDir: string): Promise<Profile> {
  if (await fileExists(refinedJsonPath(profileDir))) {
    const data = await loadRefined(profileDir);
    return data.profile;
  }
  return loadSource(profileDir);
}

function printHealthScore(profile: Profile, isRefined: boolean): void {
  const { score, contactOk, skillsOk, hasSummary, positionsOk, skillCount, noBulletCompanyNames } =
    computeHealthScore(profile, isRefined);

  const stars = healthStars(score);
  console.log(`\nProfile Health: ${stars}  ${healthQuip(score)}\n`);

  const ok = (msg: string) => `  ${c.ok}  ${msg}`;
  const warn = (msg: string) => `  ${c.warn}  ${c.warning(msg)}`;

  if (contactOk) {
    console.log(ok('Contact info complete'));
  } else {
    const missingFields = [
      !profile.contact.email && 'email',
      !profile.contact.phone && 'phone',
      !profile.contact.linkedin && 'LinkedIn URL',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(warn(`Contact info incomplete — missing: ${missingFields}`));
  }

  console.log(
    skillsOk
      ? ok(`${skillCount} skills documented`)
      : warn(`Only ${skillCount} skills documented (10+ recommended)`),
  );

  console.log(
    isRefined
      ? ok('Refined with Claude Q&A')
      : warn('Not yet refined — run Q&A refinement for better results'),
  );

  console.log(
    hasSummary
      ? ok('Professional summary present')
      : warn('No professional summary — recommended for most roles'),
  );

  if (positionsOk) {
    console.log(ok('All positions have content'));
  } else {
    const names = noBulletCompanyNames.join(', ');
    console.log(warn(`${noBulletCompanyNames.length} position(s) have no bullets (${names})`));
  }

  console.log('');
}
