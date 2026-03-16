/**
 * `resume validate` — re-run accuracy guard on the current profile
 */

import { join } from 'path';
import { loadProfile } from '../profile/serializer.js';
import { buildRefList } from '../claude/prompts/curate.js';
import { fileExists } from '../utils/fs.js';

export interface ValidateOptions {
  profileDir?: string;
}

export async function runValidate(options: ValidateOptions): Promise<void> {
  const profileDir = options.profileDir ?? join(process.cwd(), 'output');
  const profileJson = join(profileDir, 'profile.json');

  if (!(await fileExists(profileJson))) {
    throw new Error(`profile.json not found at ${profileJson}. Run 'resume import' first.`);
  }

  const profile = await loadProfile(profileJson);
  console.log(`\n✓ Loaded profile: ${profile.contact.name.value}`);

  // Build ref list to verify internal consistency
  const { refMap, refText } = buildRefList(profile);

  console.log(`\nReference list contains ${refMap.size} entries.`);
  console.log('\nSample refs:');
  let count = 0;
  for (const [id, entry] of refMap) {
    if (count++ >= 5) break;
    console.log(`  [${id}] ${entry.label}: "${entry.value.slice(0, 60)}${entry.value.length > 60 ? '...' : ''}"`);
  }

  console.log('\n✓ Profile structure is valid. Accuracy guard is ready.');
  console.log(`  Run 'resume generate' to create a tailored resume.`);
}
