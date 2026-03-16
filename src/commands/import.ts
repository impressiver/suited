import { join } from 'path';
import { detectInput } from '../ingestion/detector.js';
import { parseLinkedInExport } from '../ingestion/linkedin-export.js';
import { parseLinkedInPaste } from '../ingestion/linkedin-paste.js';
import { scrapeLinkedInProfile, clearLinkedInSession } from '../ingestion/linkedin-scraper.js';
import { extractZip, findCsvDir } from '../utils/zip.js';
import { saveProfile } from '../profile/serializer.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { Profile } from '../profile/schema.js';

export interface ImportOptions {
  input?: string;
  profileDir?: string;
  /** Show browser window during scrape (helps with 2FA / CAPTCHA) */
  headed?: boolean;
  /** Clear saved LinkedIn session and re-authenticate */
  clearSession?: boolean;
}

export async function runImport(options: ImportOptions): Promise<void> {
  const profileDir = options.profileDir ?? join(process.cwd(), 'output');
  const profileJson = join(profileDir, 'profile.json');
  const profileMd = join(profileDir, 'profile.md');

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
  console.log(`  → Detected: ${detected.kind}`);

  let profile: Profile;

  if (detected.kind === 'linkedin-url') {
    console.log('  Scraping LinkedIn profile (Claude will extract the data)...');
    const pageText = await scrapeLinkedInProfile(detected.value, {
      headed: options.headed,
    });
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

  await saveProfile(profile, profileJson);
  await profileToMarkdown(profile, profileMd);
  printSummary(profile);

  console.log(`\n✓ Profile saved:`);
  console.log(`  ${profileJson}`);
  console.log(`  ${profileMd}`);
  console.log(`\nTip: edit ${profileMd} to refine bullets, then re-run 'resume generate'.`);
}

function printSummary(profile: Profile): void {
  console.log('\nProfile summary:');
  console.log(`  Name:        ${profile.contact.name.value}`);
  console.log(`  Positions:   ${profile.positions.length}`);
  console.log(`  Education:   ${profile.education.length}`);
  console.log(`  Skills:      ${profile.skills.length}`);
  console.log(`  Projects:    ${profile.projects.length}`);
  console.log(`  Certs:       ${profile.certifications.length}`);
  console.log(`  Volunteer:   ${profile.volunteer.length}`);
}
