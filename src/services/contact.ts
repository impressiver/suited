import { profileToMarkdown } from '../profile/markdown.js';
import type { ContactMeta, Profile, Sourced } from '../profile/schema.js';
import {
  loadActiveProfile,
  loadRefined,
  refinedJsonPath,
  refinedMdPath,
  saveContactMeta,
  saveRefined,
  saveSource,
  sourceMdPath,
} from '../profile/serializer.js';
import { fileExists } from '../utils/fs.js';

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

/**
 * Writes contact fields into the active profile file (refined preferred over source) and `contact.json`.
 */
export async function mergeContactMeta(fields: ContactFields, profileDir: string): Promise<void> {
  let profile = await loadActiveProfile(profileDir);
  profile = mergeFieldsIntoProfile(profile, fields);

  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile }, profileDir);
    await profileToMarkdown(profile, refinedMdPath(profileDir));
  } else {
    await saveSource(profile, profileDir);
    await profileToMarkdown(profile, sourceMdPath(profileDir));
  }

  const meta: ContactMeta = {
    headline: profile.contact.headline?.value,
    email: profile.contact.email?.value,
    phone: profile.contact.phone?.value,
    location: profile.contact.location?.value,
    linkedin: profile.contact.linkedin?.value,
    website: profile.contact.website?.value,
    github: profile.contact.github?.value,
  };
  await saveContactMeta(meta, profileDir);
}
