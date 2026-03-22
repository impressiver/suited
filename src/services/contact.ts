import { profileToMarkdown } from '../profile/markdown.ts';
import type { ContactMeta, Profile, Sourced } from '../profile/schema.ts';
import {
  loadActiveProfile,
  loadContactMeta,
  loadRefined,
  refinedJsonPath,
  saveContactMeta,
  saveRefined,
  saveSource,
  sourceMdPath,
} from '../profile/serializer.ts';
import { fileExists } from '../utils/fs.ts';

/** Editable contact fields (subset of `ContactInfo`). */
export type ContactFields = Partial<{
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
}>;

function userEdit(value: string): Sourced<string> {
  return { value, source: { kind: 'user-edit' as const, editedAt: new Date().toISOString() } };
}

function mergeFieldsIntoProfile(profile: Profile, fields: ContactFields): Profile {
  const contact = { ...profile.contact };

  if (fields.name !== undefined) {
    contact.name = userEdit(fields.name || contact.name.value);
  }
  if (fields.headline !== undefined) {
    contact.headline = fields.headline.trim() ? userEdit(fields.headline.trim()) : undefined;
  }
  if (fields.email !== undefined) {
    contact.email = fields.email.trim() ? userEdit(fields.email.trim()) : undefined;
  }
  if (fields.phone !== undefined) {
    contact.phone = fields.phone.trim() ? userEdit(fields.phone.trim()) : undefined;
  }
  if (fields.location !== undefined) {
    contact.location = fields.location.trim() ? userEdit(fields.location.trim()) : undefined;
  }
  if (fields.linkedin !== undefined) {
    contact.linkedin = fields.linkedin.trim() ? userEdit(fields.linkedin.trim()) : undefined;
  }
  if (fields.website !== undefined) {
    contact.website = fields.website.trim() ? userEdit(fields.website.trim()) : undefined;
  }
  if (fields.github !== undefined) {
    contact.github = fields.github.trim() ? userEdit(fields.github.trim()) : undefined;
  }

  return { ...profile, contact };
}

const GLOBAL_CONTACT_KEYS: (keyof ContactMeta)[] = [
  'headline',
  'email',
  'phone',
  'location',
  'linkedin',
  'website',
  'github',
];

/**
 * Writes contact fields into the active profile file (refined preferred over source) and global contact config.
 *
 * Global `contact.json` is merged: keys not present on `fields` keep their previous values. For each global key
 * that *is* present on `fields`, a non-empty trimmed string updates that key; an empty string removes it. This
 * avoids wiping saved email/phone/etc. when the active profile temporarily lacks those fields.
 */
export async function mergeContactMeta(fields: ContactFields, profileDir: string): Promise<void> {
  let profile = await loadActiveProfile(profileDir);
  profile = mergeFieldsIntoProfile(profile, fields);

  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile }, profileDir, { reason: 'contact-merge' });
  } else {
    await saveSource(profile, profileDir);
    await profileToMarkdown(profile, sourceMdPath(profileDir));
  }

  const existing = await loadContactMeta(profileDir);
  const next: ContactMeta = { ...existing };
  for (const k of GLOBAL_CONTACT_KEYS) {
    if (!Object.hasOwn(fields, k)) continue;
    const raw = fields[k];
    if (typeof raw === 'string' && raw.trim()) {
      next[k] = raw.trim();
    } else {
      delete next[k];
    }
  }
  await saveContactMeta(next, profileDir);
}
