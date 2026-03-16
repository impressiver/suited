/**
 * `resume import` command — ingest LinkedIn profile data into profile.json + profile.md
 */

import { join } from 'path';
import { detectInput } from '../ingestion/detector.js';
import { parseLinkedInExport } from '../ingestion/linkedin-export.js';
import { parseLinkedInPaste } from '../ingestion/linkedin-paste.js';
import { extractZip, findCsvDir } from '../utils/zip.js';
import { saveProfile } from '../profile/serializer.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { fileExists } from '../utils/fs.js';

export interface ImportOptions {
  input?: string;
  profileDir?: string;
}

export async function runImport(options: ImportOptions): Promise<void> {
  const profileDir = options.profileDir ?? join(process.cwd(), 'output');
  const profileJson = join(profileDir, 'profile.json');
  const profileMd = join(profileDir, 'profile.md');

  let input = options.input;

  if (!input) {
    // If no input given, prompt for it
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: 'Path to LinkedIn export ZIP/directory, or paste your LinkedIn profile text:',
        validate: (v: string) => v.trim().length > 0 || 'Please provide input',
      },
    ]);
    input = (answers as { input: string }).input;
  }

  console.log('\nDetecting input type...');
  const detected = await detectInput(input.trim());
  console.log(`  → Detected: ${detected.kind}`);

  let csvDir: string;

  if (detected.kind === 'export-zip') {
    console.log('  Extracting ZIP...');
    const extracted = await extractZip(detected.value);
    const found = await findCsvDir(extracted);
    if (!found) throw new Error('No CSV files found in the ZIP archive.');
    csvDir = found;
    console.log(`  → Extracted to ${csvDir}`);
    console.log('Parsing LinkedIn export (no AI used)...');
    const profile = await parseLinkedInExport(csvDir);
    await saveProfile(profile, profileJson);
    await profileToMarkdown(profile, profileMd);
    printSummary(profile);
  } else if (detected.kind === 'export-dir') {
    csvDir = detected.value;
    console.log(`  → Using directory: ${csvDir}`);
    console.log('Parsing LinkedIn export (no AI used)...');
    const profile = await parseLinkedInExport(csvDir);
    await saveProfile(profile, profileJson);
    await profileToMarkdown(profile, profileMd);
    printSummary(profile);
  } else {
    // Paste — Claude-powered
    console.log('  → Parsing via Claude (verbatim extraction only)...');
    const profile = await parseLinkedInPaste(detected.value);
    await saveProfile(profile, profileJson);
    await profileToMarkdown(profile, profileMd);
    printSummary(profile);
  }

  console.log(`\n✓ Profile saved:`);
  console.log(`  ${profileJson}`);
  console.log(`  ${profileMd}`);
  console.log(`\nYou can edit ${profileMd} and run 'resume import --reload' to apply changes.`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printSummary(profile: any): void {
  console.log('\nProfile summary:');
  console.log(`  Name:        ${profile.contact.name.value}`);
  console.log(`  Positions:   ${profile.positions.length}`);
  console.log(`  Education:   ${profile.education.length}`);
  console.log(`  Skills:      ${profile.skills.length}`);
  console.log(`  Projects:    ${profile.projects.length}`);
  console.log(`  Certs:       ${profile.certifications.length}`);
}
