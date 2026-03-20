import type { Profile } from '../profile/schema.ts';
import {
  loadContactMeta,
  loadRefined,
  refinedJsonPath,
  saveContactMeta,
  saveRefined,
  saveSource,
} from '../profile/serializer.ts';
import { c } from './colors.ts';
import { fileExists } from './fs.ts';

/** Same fields as `ensureContactDetails` prompts for (human-readable labels). */
export function missingContactDetailPromptLabels(profile: Profile): string[] {
  const missing: string[] = [];
  if (!profile.contact.headline) missing.push('job title');
  if (!profile.contact.email) missing.push('email');
  if (!profile.contact.phone) missing.push('phone');
  if (!profile.contact.linkedin) missing.push('LinkedIn URL');
  return missing;
}

/**
 * Prompts for any missing contact fields (headline, email, phone, LinkedIn),
 * saves them to the active profile and to contact.json for future imports.
 * Returns the updated profile (unchanged if no fields were missing).
 */
export async function ensureContactDetails(
  profile: Profile,
  profileDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
): Promise<Profile> {
  const missing = missingContactDetailPromptLabels(profile);
  if (missing.length === 0) return profile;

  console.log(`\n${c.warn} ${c.warning(`Missing contact info: ${missing.join(', ')}`)}`);

  const now = new Date().toISOString();
  const userEdit = (v: string) => ({
    value: v,
    source: { kind: 'user-edit' as const, editedAt: now },
  });
  const updates: Partial<Profile['contact']> = {};

  if (!profile.contact.headline) {
    const { headline } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'headline',
        message: 'Current job title / headline (leave blank to skip):',
      },
    ])) as { headline: string };
    if (headline.trim()) updates.headline = userEdit(headline.trim());
  }

  if (!profile.contact.email) {
    const { email } = (await inquirer.prompt([
      { type: 'input', name: 'email', message: 'Email address (leave blank to skip):' },
    ])) as { email: string };
    if (email.trim()) updates.email = userEdit(email.trim());
  }

  if (!profile.contact.phone) {
    const { phone } = (await inquirer.prompt([
      { type: 'input', name: 'phone', message: 'Phone number (leave blank to skip):' },
    ])) as { phone: string };
    if (phone.trim()) updates.phone = userEdit(phone.trim());
  }

  if (!profile.contact.linkedin) {
    const { linkedin } = (await inquirer.prompt([
      { type: 'input', name: 'linkedin', message: 'LinkedIn URL (leave blank to skip):' },
    ])) as { linkedin: string };
    if (linkedin.trim()) updates.linkedin = userEdit(linkedin.trim());
  }

  if (Object.keys(updates).length === 0) return profile;

  const updated: Profile = { ...profile, contact: { ...profile.contact, ...updates } };

  // Persist to whichever profile is active
  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile: updated }, profileDir);
  } else {
    await saveSource(updated, profileDir);
  }

  // Also persist to contact.json so these details survive future re-imports
  const existing = await loadContactMeta(profileDir);
  await saveContactMeta(
    {
      ...existing,
      ...(updates.headline ? { headline: updates.headline.value } : {}),
      ...(updates.email ? { email: updates.email.value } : {}),
      ...(updates.phone ? { phone: updates.phone.value } : {}),
      ...(updates.linkedin ? { linkedin: updates.linkedin.value } : {}),
      ...(updates.location ? { location: updates.location.value } : {}),
    },
    profileDir,
  );

  console.log(`  ${c.ok} ${c.success('Contact details saved.')}`);

  return updated;
}
