import { detectInput } from '../ingestion/detector.js';
import { parseLinkedInExport } from '../ingestion/linkedin-export.js';
import { parseLinkedInPaste } from '../ingestion/linkedin-paste.js';
import { clearLinkedInSession, scrapeLinkedInProfile } from '../ingestion/linkedin-scraper.js';
import { profileToMarkdown } from '../profile/markdown.js';
import type { Profile } from '../profile/schema.js';
import {
  loadContactMeta,
  mergeContactMeta,
  saveSource,
  sourceJsonPath,
  sourceMdPath,
} from '../profile/serializer.js';
import { c } from '../utils/colors.js';
import { ensureContactDetails } from '../utils/contact.js';
import { extractZip, findCsvDir } from '../utils/zip.js';

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
  const detected = await detectInput(input.trim());
  console.log(`  ${c.arr} ${c.value(detected.kind)}`);

  let profile: Profile;

  if (detected.kind === 'linkedin-url') {
    console.log(c.muted('  Scraping LinkedIn profile...'));
    const pageText = await scrapeLinkedInProfile(detected.value, { headed: options.headed });
    console.log(c.muted('  Extracting data with Claude (verbatim only, no embellishment)...'));
    profile = await parseLinkedInPaste(pageText);
  } else if (detected.kind === 'export-zip') {
    console.log(c.muted('  Unzipping the goods...'));
    const extracted = await extractZip(detected.value);
    const found = await findCsvDir(extracted);
    if (!found) throw new Error('No CSV files found in the ZIP archive.');
    console.log(c.muted('  Parsing LinkedIn export (no AI, just raw data)...'));
    profile = await parseLinkedInExport(found);
  } else if (detected.kind === 'export-dir') {
    console.log('  Parsing LinkedIn export (no AI used)...');
    profile = await parseLinkedInExport(detected.value);
  } else {
    console.log('  Parsing with Claude (verbatim extraction only)...');
    profile = await parseLinkedInPaste(detected.value);
  }

  // Merge any previously saved contact metadata (email, phone, etc.)
  // so re-imports don't wipe out manually entered contact details.
  const contactMeta = await loadContactMeta(profileDir);
  profile = mergeContactMeta(profile, contactMeta);

  await saveSource(profile, profileDir);
  await profileToMarkdown(profile, sourceMdPath(profileDir));
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
