import type { Profile, Sourced } from '../profile/schema.ts';
import { loadActiveProfile } from '../profile/serializer.ts';
import { type ContactFields, mergeContactMeta } from '../services/contact.ts';
import { c } from '../utils/colors.ts';
import { isUserExit } from '../utils/user-exit.ts';

export interface ContactOptions {
  profileDir?: string;
}

function displayContactFields(profile: Profile): void {
  const contact = profile.contact;
  const val = (v: Sourced<string> | undefined) => (v ? c.value(v.value) : c.muted('(blank)'));

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
      const ans = (await inquirer.prompt([
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
      ])) as { action: string };
      action = ans.action;
    } catch (err) {
      if (isUserExit(err)) return;
      throw err;
    }

    if (action === 'back') return;

    // Pick which field
    const { field } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'field',
        message: 'Which field?',
        choices: [
          { value: 'name', name: `Name       ${profile.contact.name.value}` },
          { value: 'headline', name: `Headline   ${profile.contact.headline?.value ?? '(blank)'}` },
          { value: 'email', name: `Email      ${profile.contact.email?.value ?? '(blank)'}` },
          { value: 'phone', name: `Phone      ${profile.contact.phone?.value ?? '(blank)'}` },
          { value: 'location', name: `Location   ${profile.contact.location?.value ?? '(blank)'}` },
          { value: 'linkedin', name: `LinkedIn   ${profile.contact.linkedin?.value ?? '(blank)'}` },
          { value: 'website', name: `Website    ${profile.contact.website?.value ?? '(blank)'}` },
          { value: 'github', name: `GitHub     ${profile.contact.github?.value ?? '(blank)'}` },
          { value: 'cancel', name: c.muted('← Cancel') },
        ],
      },
    ])) as { field: string };

    if (field === 'cancel') continue;

    const currentValue = (() => {
      switch (field) {
        case 'name':
          return profile.contact.name.value;
        case 'headline':
          return profile.contact.headline?.value ?? '';
        case 'email':
          return profile.contact.email?.value ?? '';
        case 'phone':
          return profile.contact.phone?.value ?? '';
        case 'location':
          return profile.contact.location?.value ?? '';
        case 'linkedin':
          return profile.contact.linkedin?.value ?? '';
        case 'website':
          return profile.contact.website?.value ?? '';
        case 'github':
          return profile.contact.github?.value ?? '';
        default:
          return '';
      }
    })();

    const { newValue } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'newValue',
        message: `New value for ${field}:`,
        default: currentValue,
      },
    ])) as { newValue: string };

    const trimmed = newValue.trim();
    if (trimmed === currentValue) {
      console.log(c.muted('  No changes made.'));
      continue;
    }

    const patch: Partial<ContactFields> =
      field === 'name' ? { name: trimmed || profile.contact.name.value } : { [field]: trimmed };
    await mergeContactMeta(patch as ContactFields, profileDir);
    profile = await loadActiveProfile(profileDir);
    console.log(`\n${c.ok} ${c.success(`${field} updated.`)}`);
  }
}
