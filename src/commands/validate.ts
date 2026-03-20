/**
 * `resume validate` — re-run accuracy guard on the current profile
 */

import { loadActiveProfile, sourceJsonPath } from '../profile/serializer.js';
import { validateProfile } from '../services/validate.js';
import { c } from '../utils/colors.js';
import { fileExists } from '../utils/fs.js';

export interface ValidateOptions {
  profileDir?: string;
}

export async function runValidate(options: ValidateOptions): Promise<void> {
  const profileDir = options.profileDir ?? 'output';

  if (!(await fileExists(sourceJsonPath(profileDir)))) {
    throw new Error(`source.json not found in ${profileDir}. Run 'resume import' first.`);
  }

  const profile = await loadActiveProfile(profileDir);
  console.log(`\n${c.ok} Loaded profile: ${c.value(profile.contact.name.value)}`);

  const { referenceCount, refMap } = validateProfile(profile);

  console.log(`\n${c.muted(`Reference list: ${referenceCount} entries`)}`);
  let count = 0;
  for (const [id, entry] of refMap) {
    if (count++ >= 5) break;
    console.log(
      `  ${c.muted(`[${id}]`)} ${c.label(`${entry.label}:`)} "${entry.value.slice(0, 60)}${entry.value.length > 60 ? '…' : ''}"`,
    );
  }

  console.log(`\n${c.ok} ${c.success('Profile structure is valid. Accuracy guard is ready.')}`);
  console.log(c.tip("  Run 'resume generate' to create a resume."));
}
