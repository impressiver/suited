import { detectInput } from '../ingestion/detector.js';
import { parseLinkedInExport } from '../ingestion/linkedin-export.js';
import { parseLinkedInPaste } from '../ingestion/linkedin-paste.js';
import { scrapeLinkedInProfile, clearLinkedInSession } from '../ingestion/linkedin-scraper.js';
import { extractZip, findCsvDir } from '../utils/zip.js';
import { saveSource, sourceMdPath, sourceJsonPath, loadContactMeta, mergeContactMeta } from '../profile/serializer.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { Profile } from '../profile/schema.js';
import { c } from '../utils/colors.js';

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

  console.log('\nDetecting input type...');
  const detected = await detectInput(input.trim());
  console.log(`  ${c.arr} Detected: ${c.value(detected.kind)}`);

  let profile: Profile;

  if (detected.kind === 'linkedin-url') {
    console.log('  Scraping LinkedIn profile (Claude will extract the data)...');
    const pageText = await scrapeLinkedInProfile(detected.value, { headed: options.headed });
    console.log('  Parsing with Claude (verbatim extraction only)...');
    profile = await parseLinkedInPaste(pageText);

  } else if (detected.kind === 'export-zip') {
    console.log('  Extracting ZIP...');
    const extracted = await extractZip(detected.value);
    const found = await findCsvDir(extracted);
    if (!found) throw new Error('No CSV files found in the ZIP archive.');
    console.log('  Parsing LinkedIn export (no AI used)...');
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

  console.log(`\n${c.ok} ${c.success('Source data saved:')}`);
  console.log(`   ${c.path(sourceJsonPath(profileDir))}`);
  console.log(`   ${c.path(sourceMdPath(profileDir))}`);

  if (!options.flow) {
    console.log(`\n${c.tip("Next: run 'resume refine' to improve and expand your profile with Claude's help.")}`);
  }
}

function printSummary(profile: Profile): void {
  console.log('\nProfile summary:');
  console.log(`  ${c.label('Name:')}      ${profile.contact.name.value}`);
  console.log(`  ${c.label('Positions:')} ${profile.positions.length}`);
  console.log(`  ${c.label('Education:')} ${profile.education.length}`);
  console.log(`  ${c.label('Skills:')}    ${profile.skills.length}`);
  console.log(`  ${c.label('Projects:')}  ${profile.projects.length}`);
  console.log(`  ${c.label('Certs:')}     ${profile.certifications.length}`);
  console.log(`  ${c.label('Volunteer:')} ${profile.volunteer.length}`);
}
