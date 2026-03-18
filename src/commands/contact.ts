import {
  loadActiveProfile, loadRefined, saveRefined, saveSource, saveContactMeta,
  refinedJsonPath, refinedMdPath, sourceMdPath,
} from '../profile/serializer.js';
import { isUserExit } from '../utils/user-exit.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { fileExists } from '../utils/fs.js';
import { c } from '../utils/colors.js';
import type { Profile, Sourced, ContactMeta } from '../profile/schema.js';

export interface ContactOptions {
  profileDir?: string;
}

function userEdit(value: string): Sourced<string> {
  return { value, source: { kind: 'user-edit' as const, editedAt: new Date().toISOString() } };
}

async function persistProfileAndContact(
  profile: Profile,
  profileDir: string,
): Promise<void> {
  // Save to active profile (refined or source)
  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile }, profileDir);
    await profileToMarkdown(profile, refinedMdPath(profileDir));
  } else {
    await saveSource(profile, profileDir);
    await profileToMarkdown(profile, sourceMdPath(profileDir));
  }

  // Also persist contact fields to contact.json
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

function displayContactFields(profile: Profile): void {
  const contact = profile.contact;
  const val = (v: Sourced<string> | undefined) => v ? c.value(v.value) : c.muted('(blank)');

  console.log();
  console.log(`  ${c.label('Name:')}      ${val(contact.name)}`);
  console.log(`  ${c.label('Headline:')} ${val(contact.headline)}`);
  console.log(`  ${c.label('Email:')}    ${val(contact.email)}`);
  console.log(`  ${c.label('Phone:')}    ${val(contact.phone)}`);
  console.log(`  ${c.label('Location:')} ${val(contact.location)}`);
  console.log(`  ${c.label('LinkedIn:')} ${val(contact.linkedin)}`);
  console.log(`  ${c.label('Website:')}  ${val(contact.website)}`);
  console.log(`  ${c.label('GitHub:')}   ${val(contact.github)}`);
  console.log();
}

export async function runContact(options: ContactOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  let profile = await loadActiveProfile(profileDir);

  while (true) {
    console.log(`\n${c.header('── Contact Info ──')}`);
    displayContactFields(profile);

    let action: string;
    try {
      const ans = await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'action',
          message: 'Contact info:',
          choices: [
            { value: 'edit', name: 'Edit a field' },
            { value: 'back', name: c.muted('← Back') },
          ],
        },
      ]) as { action: string };
      action = ans.action;
    } catch (err) {
      if (isUserExit(err)) return;
      throw err;
    }

    if (action === 'back') return;

    // Pick which field
    const { field } = await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'field',
        message: 'Which field?',
        choices: [
          { value: 'name',     name: `Name       ${profile.contact.name.value}` },
          { value: 'headline', name: `Headline   ${profile.contact.headline?.value ?? '(blank)'}` },
          { value: 'email',    name: `Email      ${profile.contact.email?.value ?? '(blank)'}` },
          { value: 'phone',    name: `Phone      ${profile.contact.phone?.value ?? '(blank)'}` },
          { value: 'location', name: `Location   ${profile.contact.location?.value ?? '(blank)'}` },
          { value: 'linkedin', name: `LinkedIn   ${profile.contact.linkedin?.value ?? '(blank)'}` },
          { value: 'website',  name: `Website    ${profile.contact.website?.value ?? '(blank)'}` },
          { value: 'github',   name: `GitHub     ${profile.contact.github?.value ?? '(blank)'}` },
          { value: 'cancel',   name: c.muted('← Cancel') },
        ],
      },
    ]) as { field: string };

    if (field === 'cancel') continue;

    const currentValue = (() => {
      switch (field) {
        case 'name':     return profile.contact.name.value;
        case 'headline': return profile.contact.headline?.value ?? '';
        case 'email':    return profile.contact.email?.value ?? '';
        case 'phone':    return profile.contact.phone?.value ?? '';
        case 'location': return profile.contact.location?.value ?? '';
        case 'linkedin': return profile.contact.linkedin?.value ?? '';
        case 'website':  return profile.contact.website?.value ?? '';
        case 'github':   return profile.contact.github?.value ?? '';
        default:         return '';
      }
    })();

    const { newValue } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newValue',
        message: `New value for ${field}:`,
        default: currentValue,
      },
    ]) as { newValue: string };

    const trimmed = newValue.trim();
    if (trimmed === currentValue) {
      console.log(c.muted('  No changes made.'));
      continue;
    }

    const contact = { ...profile.contact };
    switch (field) {
      case 'name':     contact.name     = userEdit(trimmed || contact.name.value); break;
      case 'headline': contact.headline = trimmed ? userEdit(trimmed) : undefined; break;
      case 'email':    contact.email    = trimmed ? userEdit(trimmed) : undefined; break;
      case 'phone':    contact.phone    = trimmed ? userEdit(trimmed) : undefined; break;
      case 'location': contact.location = trimmed ? userEdit(trimmed) : undefined; break;
      case 'linkedin': contact.linkedin = trimmed ? userEdit(trimmed) : undefined; break;
      case 'website':  contact.website  = trimmed ? userEdit(trimmed) : undefined; break;
      case 'github':   contact.github   = trimmed ? userEdit(trimmed) : undefined; break;
    }

    profile = { ...profile, contact };
    await persistProfileAndContact(profile, profileDir);
    console.log(`\n${c.ok} ${c.success(`${field} updated.`)}`);
  }
}
