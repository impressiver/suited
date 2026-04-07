import { z } from 'zod';
import { profileToMarkdown } from '../profile/markdown.ts';
import type { ContactMeta, Profile, Sourced } from '../profile/schema.ts';
import {
  loadActiveProfile,
  loadContactMeta,
  loadJobRefinedProfile,
  loadRefined,
  refinedJsonPath,
  saveContactMeta,
  saveJobRefinedProfile,
  saveRefined,
  saveSource,
  sourceMdPath,
} from '../profile/serializer.ts';
import type { PersistenceTarget } from '../tui/activeDocumentSession.ts';
import { fileExists } from '../utils/fs.ts';

/** Zod schema for contact field validation. */
export const ContactFieldsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  headline: z.string().max(200, 'Headline is too long').optional(),
  email: z.union([z.literal(''), z.string().email('Invalid email address')]).optional(),
  phone: z.string().max(50, 'Phone number is too long').optional(),
  location: z.string().max(100, 'Location is too long').optional(),
  linkedin: z
    .union([
      z.literal(''),
      z
        .string()
        .url('Invalid LinkedIn URL')
        .startsWith('https://linkedin.com/', 'LinkedIn URL should start with https://linkedin.com/')
        .startsWith(
          'https://www.linkedin.com/',
          'LinkedIn URL should start with https://linkedin.com/',
        )
        .or(
          z
            .string()
            .url()
            .regex(/linkedin\.com\//),
        ),
    ])
    .optional(),
  website: z
    .union([
      z.literal(''),
      z
        .string()
        .url('Invalid website URL')
        .startsWith('https://', 'URL should start with https://'),
    ])
    .optional(),
  github: z
    .union([
      z.literal(''),
      z
        .string()
        .url('Invalid GitHub URL')
        .startsWith('https://github.com/', 'GitHub URL should start with https://github.com/')
        .or(z.string().regex(/^@[a-zA-Z0-9_-]+$/, 'GitHub username should start with @')),
    ])
    .optional(),
});

/** Inferred type from Zod schema. */
export type ContactFields = z.infer<typeof ContactFieldsSchema>;

/** Validate contact fields and return parsed/trimmed values or validation errors. */
export function validateContactFields(fields: Partial<ContactFields>):
  | {
      success: true;
      data: ContactFields;
    }
  | {
      success: false;
      errors: Record<string, string>;
    } {
  const result = ContactFieldsSchema.safeParse(fields);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as string;
    errors[key] = issue.message;
  }

  return { success: false, errors };
}

function userEdit(value: string): Sourced<string> {
  return { value, source: { kind: 'user-edit' as const, editedAt: new Date().toISOString() } };
}

function mergeFieldsIntoProfile(profile: Profile, fields: ContactFields): Profile {
  const contact = { ...profile.contact };

  // Helper to handle field updates - empty string clears the field, undefined keeps existing
  const updateField = (key: keyof ContactFields, targetKey: keyof typeof contact) => {
    const value = fields[key];
    if (value === undefined) return; // Not provided, keep existing
    if (typeof value === 'string' && value.trim() === '') {
      // Empty string - clear the field (set to undefined for optional fields)
      (contact as Record<string, unknown>)[targetKey] = undefined;
    } else if (value !== undefined) {
      // Non-empty value - update with user edit (ensure it's a string)
      (contact as Record<string, unknown>)[targetKey] = userEdit(String(value).trim());
    }
  };

  updateField('name', 'name');
  updateField('headline', 'headline');
  updateField('email', 'email');
  updateField('phone', 'phone');
  updateField('location', 'location');
  updateField('linkedin', 'linkedin');
  updateField('website', 'website');
  updateField('github', 'github');

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

export type MergeContactMetaOptions = {
  /** When omitted or `global-refined`, behavior matches legacy CLI (global refined.json / source). */
  persistenceTarget?: PersistenceTarget;
};

/**
 * Writes contact fields into the active profile file and global contact config.
 *
 * **Global target (default):** Base profile is `loadActiveProfile` (global `refined.json` if present, else
 * `source.json`). Persists via `saveRefined` when refined exists, else `saveSource` + source markdown.
 *
 * **Job target:** Base profile is `loadJobRefinedProfile(profileDir, slug)` when that file exists; otherwise
 * `loadActiveProfile` (same as the effective document the user sees when no job overlay exists yet). Persists
 * only via `saveJobRefinedProfile` — never `saveRefined` / global refined.
 *
 * Global `contact.json` is merged: keys not present on `fields` keep their previous values. For each global key
 * that *is* present on `fields`, a non-empty trimmed string updates that key; an empty string removes it. This
 * avoids wiping saved email/phone/etc. when the active profile temporarily lacks those fields.
 */
export async function mergeContactMeta(
  fields: ContactFields,
  profileDir: string,
  options?: MergeContactMetaOptions,
): Promise<void> {
  const target = options?.persistenceTarget ?? { kind: 'global-refined' as const };

  let profile: Profile;
  if (target.kind === 'job') {
    const jobProfile = await loadJobRefinedProfile(profileDir, target.slug);
    profile = jobProfile ?? (await loadActiveProfile(profileDir));
  } else {
    profile = await loadActiveProfile(profileDir);
  }

  profile = mergeFieldsIntoProfile(profile, fields);

  if (target.kind === 'job') {
    await saveJobRefinedProfile(profile, profileDir, target.slug);
  } else if (await fileExists(refinedJsonPath(profileDir))) {
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
