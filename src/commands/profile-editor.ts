import { profileToMarkdown } from '../profile/markdown.ts';
import type {
  Certification,
  Education,
  Position,
  Profile,
  Project,
  Sourced,
} from '../profile/schema.ts';
import {
  loadActiveProfile,
  loadRefined,
  refinedJsonPath,
  saveRefined,
  saveSource,
  sourceMdPath,
} from '../profile/serializer.ts';
import { c } from '../utils/colors.ts';
import { fileExists } from '../utils/fs.ts';
import { isUserExit } from '../utils/user-exit.ts';

export interface ProfileEditorOptions {
  profileDir?: string;
}

// ---------------------------------------------------------------------------
// Persist helper
// ---------------------------------------------------------------------------

async function persistProfile(profile: Profile, profileDir: string): Promise<void> {
  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile }, profileDir, { reason: 'profile-editor' });
  } else {
    await saveSource(profile, profileDir);
    await profileToMarkdown(profile, sourceMdPath(profileDir));
  }
}

function userEdit(value: string): Sourced<string> {
  return { value, source: { kind: 'user-edit' as const, editedAt: new Date().toISOString() } };
}

function formatDateRange(startDate: string, endDate?: string): string {
  const start = startDate.slice(0, 4);
  const end = endDate ? endDate.slice(0, 4) : 'Present';
  return `${start}–${end}`;
}

// ---------------------------------------------------------------------------
// Summary editor
// ---------------------------------------------------------------------------

async function runSummaryEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  const current = profile.summary?.value ?? '(none)';
  console.log(`\n  Current summary: ${c.value(current)}\n`);

  const { newText } = (await inquirer.prompt([
    {
      type: 'input',
      name: 'newText',
      message: 'New summary (leave blank to keep current):',
      default: profile.summary?.value ?? '',
    },
  ])) as { newText: string };

  const trimmed = newText.trim();
  if (!trimmed || trimmed === (profile.summary?.value ?? '')) {
    console.log(c.muted('  No changes made.'));
    return profile;
  }

  const updated: Profile = { ...profile, summary: userEdit(trimmed) };
  await persistProfile(updated, profileDir);
  console.log(`\n${c.ok} ${c.success('Summary saved.')}`);
  return updated;
}

// ---------------------------------------------------------------------------
// Bullets editor
// ---------------------------------------------------------------------------

async function runBulletsEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  posIdx: number,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    const pos = profile.positions[posIdx];
    console.log(`\n  ${c.value(`${pos.title.value} @ ${pos.company.value}`)}`);

    if (pos.bullets.length === 0) {
      console.log(`  ${c.muted('(no bullets yet)')}`);
    } else {
      pos.bullets.forEach((b, i) => {
        const preview = b.value.length > 80 ? `${b.value.slice(0, 80)}…` : b.value;
        console.log(`  ${c.muted(`[${i}]`)} ${preview}`);
      });
    }

    const editChoices = pos.bullets.map((b, i) => ({
      name: `[${i}] ${b.value.slice(0, 60)}${b.value.length > 60 ? '…' : ''}`,
      value: `edit:${i}`,
    }));

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Bullets:',
        choices: [
          ...editChoices,
          { name: '+ Add bullet', value: 'add' },
          ...(pos.bullets.length > 0 ? [{ name: '− Remove bullet(s)', value: 'remove' }] : []),
          { name: c.muted('← Back'), value: 'back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { text } = (await inquirer.prompt([
        { type: 'input', name: 'text', message: 'New bullet text:' },
      ])) as { text: string };
      if (text.trim()) {
        const newPositions = [...profile.positions];
        newPositions[posIdx] = {
          ...pos,
          bullets: [...pos.bullets, userEdit(text.trim())],
        };
        profile = { ...profile, positions: newPositions };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success('Bullet added.')}`);
      }
      continue;
    }

    if (action === 'remove') {
      const { toRemove } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: 'Select bullets to remove:',
          choices: pos.bullets.map((b, i) => ({
            name: `[${i}] ${b.value.slice(0, 70)}`,
            value: i,
          })),
        },
      ])) as { toRemove: number[] };

      if (toRemove.length > 0) {
        const removeSet = new Set(toRemove);
        const newPositions = [...profile.positions];
        newPositions[posIdx] = {
          ...pos,
          bullets: pos.bullets.filter((_, i) => !removeSet.has(i)),
        };
        profile = { ...profile, positions: newPositions };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`${toRemove.length} bullet(s) removed.`)}`);
      }
      continue;
    }

    // edit:N
    const bulletIdx = parseInt(action.split(':')[1], 10);
    const currentBullet = pos.bullets[bulletIdx].value;
    const { edited } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'edited',
        message: 'Edit bullet:',
        default: currentBullet,
      },
    ])) as { edited: string };

    if (edited.trim() && edited.trim() !== currentBullet) {
      const newPositions = [...profile.positions];
      const newBullets = [...pos.bullets];
      newBullets[bulletIdx] = userEdit(edited.trim());
      newPositions[posIdx] = { ...pos, bullets: newBullets };
      profile = { ...profile, positions: newPositions };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Bullet updated.')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Single position editor
// ---------------------------------------------------------------------------

async function runPositionEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  posIdx: number,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    const pos = profile.positions[posIdx];
    console.log(`\n  ${c.value(`${pos.title.value} @ ${pos.company.value}`)}`);

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Edit position:',
        choices: [
          { value: 'fields', name: 'Edit title / company / location / dates' },
          { value: 'bullets', name: `Edit bullets  (${pos.bullets.length} bullets)` },
          { value: 'delete', name: c.error('Delete this position') },
          { value: 'back', name: c.muted('← Back') },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'delete') {
      const { confirm } = (await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete "${pos.title.value} @ ${pos.company.value}"?`,
          default: false,
        },
      ])) as { confirm: boolean };

      if (confirm) {
        const newPositions = profile.positions.filter((_, i) => i !== posIdx);
        profile = { ...profile, positions: newPositions };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success('Position deleted.')}`);
        return profile;
      }
      continue;
    }

    if (action === 'bullets') {
      profile = await runBulletsEditor(inquirer, profile, posIdx, profileDir);
      continue;
    }

    if (action === 'fields') {
      const { title } = (await inquirer.prompt([
        { type: 'input', name: 'title', message: 'Title:', default: pos.title.value },
      ])) as { title: string };
      const { company } = (await inquirer.prompt([
        { type: 'input', name: 'company', message: 'Company:', default: pos.company.value },
      ])) as { company: string };
      const { location } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'location',
          message: 'Location (optional):',
          default: pos.location?.value ?? '',
        },
      ])) as { location: string };
      const { startDate } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'startDate',
          message: 'Start date (YYYY-MM):',
          default: pos.startDate.value,
        },
      ])) as { startDate: string };
      const { endDate } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'endDate',
          message: 'End date (YYYY-MM or blank for Present):',
          default: pos.endDate?.value ?? '',
        },
      ])) as { endDate: string };

      const newPositions = [...profile.positions];
      newPositions[posIdx] = {
        ...pos,
        title: title.trim() ? userEdit(title.trim()) : pos.title,
        company: company.trim() ? userEdit(company.trim()) : pos.company,
        location: location.trim() ? userEdit(location.trim()) : pos.location,
        startDate: startDate.trim() ? userEdit(startDate.trim()) : pos.startDate,
        endDate: endDate.trim() ? userEdit(endDate.trim()) : undefined,
      };
      profile = { ...profile, positions: newPositions };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Position updated.')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Experience editor
// ---------------------------------------------------------------------------

async function runExperienceEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    console.log(`\n  ${c.header('── Experience ──')}\n`);

    const posChoices = profile.positions.map((pos, i) => {
      const range = formatDateRange(pos.startDate.value, pos.endDate?.value);
      const label = `${pos.title.value} @ ${pos.company.value}  ${range} · ${pos.bullets.length} bullets`;
      return { name: label, value: `pos:${i}` };
    });

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Experience:',
        choices: [
          ...posChoices,
          { name: '+ Add position', value: 'add' },
          { name: c.muted('← Back'), value: 'back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { title } = (await inquirer.prompt([
        { type: 'input', name: 'title', message: 'Title (required):' },
      ])) as { title: string };
      if (!title.trim()) {
        console.log(c.muted('Title is required.'));
        continue;
      }

      const { company } = (await inquirer.prompt([
        { type: 'input', name: 'company', message: 'Company (required):' },
      ])) as { company: string };
      if (!company.trim()) {
        console.log(c.muted('Company is required.'));
        continue;
      }

      const { location } = (await inquirer.prompt([
        { type: 'input', name: 'location', message: 'Location (optional):' },
      ])) as { location: string };
      const { startDate } = (await inquirer.prompt([
        { type: 'input', name: 'startDate', message: 'Start date (YYYY-MM):' },
      ])) as { startDate: string };
      const { endDate } = (await inquirer.prompt([
        { type: 'input', name: 'endDate', message: 'End date (YYYY-MM or blank for Present):' },
      ])) as { endDate: string };

      // Collect bullets one at a time
      const bullets: Sourced<string>[] = [];
      console.log(c.muted('  Enter bullets one at a time. Press Enter with blank to finish.'));
      while (true) {
        const { bullet } = (await inquirer.prompt([
          {
            type: 'input',
            name: 'bullet',
            message: `Bullet ${bullets.length + 1} (blank to finish):`,
          },
        ])) as { bullet: string };
        if (!bullet.trim()) break;
        bullets.push(userEdit(bullet.trim()));
      }

      const newPos: Position = {
        id: `pos-${Date.now()}`,
        title: userEdit(title.trim()),
        company: userEdit(company.trim()),
        location: location.trim() ? userEdit(location.trim()) : undefined,
        startDate: userEdit(startDate.trim() || new Date().toISOString().slice(0, 7)),
        endDate: endDate.trim() ? userEdit(endDate.trim()) : undefined,
        bullets,
      };

      profile = { ...profile, positions: [...profile.positions, newPos] };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Position added.')}`);
      continue;
    }

    // pos:N
    const posIdx = parseInt(action.split(':')[1], 10);
    profile = await runPositionEditor(inquirer, profile, posIdx, profileDir);
  }
}

// ---------------------------------------------------------------------------
// Skills editor
// ---------------------------------------------------------------------------

async function runSkillsEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    console.log(`\n  ${c.header('── Skills ──')}\n`);

    // Show skills in a grid (4 per row)
    const skillNames = profile.skills.map((s) => s.name.value);
    if (skillNames.length === 0) {
      console.log(`  ${c.muted('(no skills yet)')}`);
    } else {
      const rows: string[] = [];
      for (let i = 0; i < skillNames.length; i += 4) {
        rows.push(
          '  ' +
            skillNames
              .slice(i, i + 4)
              .map((s) => s.padEnd(20))
              .join('  ')
              .trimEnd(),
        );
      }
      for (const r of rows) {
        console.log(r);
      }
    }
    console.log();

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Skills:',
        choices: [
          { value: 'add', name: 'Add skill(s)  (comma-separated)' },
          ...(profile.skills.length > 0 ? [{ value: 'remove', name: 'Remove skill(s)' }] : []),
          { value: 'back', name: c.muted('← Back') },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { skillInput } = (await inquirer.prompt([
        { type: 'input', name: 'skillInput', message: 'Skills to add (comma-separated):' },
      ])) as { skillInput: string };
      const newSkillNames = skillInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const existingNames = new Set(profile.skills.map((s) => s.name.value.toLowerCase()));
      const nextId = profile.skills.length;
      const newSkills = newSkillNames
        .filter((s) => !existingNames.has(s.toLowerCase()))
        .map((s, i) => ({ id: `skill-${nextId + i}`, name: userEdit(s) }));
      if (newSkills.length > 0) {
        profile = { ...profile, skills: [...profile.skills, ...newSkills] };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`Added ${newSkills.length} skill(s).`)}`);
      } else {
        console.log(c.muted('  All skills already exist.'));
      }
      continue;
    }

    if (action === 'remove') {
      const { toRemove } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: 'Select skills to remove:',
          choices: profile.skills.map((s) => ({ name: s.name.value, value: s.id })),
        },
      ])) as { toRemove: string[] };
      if (toRemove.length > 0) {
        const removeSet = new Set(toRemove);
        profile = { ...profile, skills: profile.skills.filter((s) => !removeSet.has(s.id)) };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`Removed ${toRemove.length} skill(s).`)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Education editor
// ---------------------------------------------------------------------------

async function runEducationEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    console.log(`\n  ${c.header('── Education ──')}\n`);

    const choices = profile.education.map((edu, i) => {
      const label = [edu.degree?.value, edu.fieldOfStudy?.value, edu.institution.value]
        .filter(Boolean)
        .join(' — ');
      return { name: label, value: `edu:${i}` };
    });

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Education:',
        choices: [
          ...choices,
          { name: '+ Add entry', value: 'add' },
          ...(profile.education.length > 0 ? [{ name: '− Remove entry', value: 'remove' }] : []),
          { name: c.muted('← Back'), value: 'back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { institution } = (await inquirer.prompt([
        { type: 'input', name: 'institution', message: 'Institution (required):' },
      ])) as { institution: string };
      if (!institution.trim()) {
        console.log(c.muted('Institution is required.'));
        continue;
      }

      const { degree } = (await inquirer.prompt([
        { type: 'input', name: 'degree', message: 'Degree (optional):' },
      ])) as { degree: string };
      const { fieldOfStudy } = (await inquirer.prompt([
        { type: 'input', name: 'fieldOfStudy', message: 'Field of study (optional):' },
      ])) as { fieldOfStudy: string };
      const { startDate } = (await inquirer.prompt([
        { type: 'input', name: 'startDate', message: 'Start date (YYYY-MM, optional):' },
      ])) as { startDate: string };
      const { endDate } = (await inquirer.prompt([
        { type: 'input', name: 'endDate', message: 'End date (YYYY-MM, optional):' },
      ])) as { endDate: string };

      const newEdu: Education = {
        id: `edu-${Date.now()}`,
        institution: userEdit(institution.trim()),
        degree: degree.trim() ? userEdit(degree.trim()) : undefined,
        fieldOfStudy: fieldOfStudy.trim() ? userEdit(fieldOfStudy.trim()) : undefined,
        startDate: startDate.trim() ? userEdit(startDate.trim()) : undefined,
        endDate: endDate.trim() ? userEdit(endDate.trim()) : undefined,
      };

      profile = { ...profile, education: [...profile.education, newEdu] };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Education entry added.')}`);
      continue;
    }

    if (action === 'remove') {
      const { toRemove } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: 'Select entries to remove:',
          choices: profile.education.map((edu, i) => ({
            name: edu.institution.value,
            value: i,
          })),
        },
      ])) as { toRemove: number[] };
      if (toRemove.length > 0) {
        const removeSet = new Set(toRemove);
        profile = { ...profile, education: profile.education.filter((_, i) => !removeSet.has(i)) };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`Removed ${toRemove.length} entry/entries.`)}`);
      }
      continue;
    }

    // edu:N — edit
    const eduIdx = parseInt(action.split(':')[1], 10);
    const edu = profile.education[eduIdx];

    const { institution } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'institution',
        message: 'Institution:',
        default: edu.institution.value,
      },
    ])) as { institution: string };
    const { degree } = (await inquirer.prompt([
      { type: 'input', name: 'degree', message: 'Degree:', default: edu.degree?.value ?? '' },
    ])) as { degree: string };
    const { fieldOfStudy } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'fieldOfStudy',
        message: 'Field of study:',
        default: edu.fieldOfStudy?.value ?? '',
      },
    ])) as { fieldOfStudy: string };
    const { startDate } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'startDate',
        message: 'Start date (YYYY-MM):',
        default: edu.startDate?.value ?? '',
      },
    ])) as { startDate: string };
    const { endDate } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'endDate',
        message: 'End date (YYYY-MM):',
        default: edu.endDate?.value ?? '',
      },
    ])) as { endDate: string };

    const newEdu: Education = {
      ...edu,
      institution: userEdit(institution.trim() || edu.institution.value),
      degree: degree.trim() ? userEdit(degree.trim()) : edu.degree,
      fieldOfStudy: fieldOfStudy.trim() ? userEdit(fieldOfStudy.trim()) : edu.fieldOfStudy,
      startDate: startDate.trim() ? userEdit(startDate.trim()) : edu.startDate,
      endDate: endDate.trim() ? userEdit(endDate.trim()) : edu.endDate,
    };

    const newEducation = [...profile.education];
    newEducation[eduIdx] = newEdu;
    profile = { ...profile, education: newEducation };
    await persistProfile(profile, profileDir);
    console.log(`${c.ok} ${c.success('Education updated.')}`);
  }
}

// ---------------------------------------------------------------------------
// Certifications editor
// ---------------------------------------------------------------------------

async function runCertificationsEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    console.log(`\n  ${c.header('── Certifications ──')}\n`);

    const choices = profile.certifications.map((cert, i) => {
      const label = cert.authority?.value
        ? `${cert.name.value} — ${cert.authority.value}`
        : cert.name.value;
      return { name: label, value: `cert:${i}` };
    });

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Certifications:',
        choices: [
          ...choices,
          { name: '+ Add entry', value: 'add' },
          ...(profile.certifications.length > 0
            ? [{ name: '− Remove entry', value: 'remove' }]
            : []),
          { name: c.muted('← Back'), value: 'back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { name } = (await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Certification name (required):' },
      ])) as { name: string };
      if (!name.trim()) {
        console.log(c.muted('Name is required.'));
        continue;
      }

      const { authority } = (await inquirer.prompt([
        { type: 'input', name: 'authority', message: 'Issuing authority (optional):' },
      ])) as { authority: string };
      const { startDate } = (await inquirer.prompt([
        { type: 'input', name: 'startDate', message: 'Date (YYYY-MM, optional):' },
      ])) as { startDate: string };

      const newCert: Certification = {
        id: `cert-${Date.now()}`,
        name: userEdit(name.trim()),
        authority: authority.trim() ? userEdit(authority.trim()) : undefined,
        startDate: startDate.trim() ? userEdit(startDate.trim()) : undefined,
      };

      profile = { ...profile, certifications: [...profile.certifications, newCert] };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Certification added.')}`);
      continue;
    }

    if (action === 'remove') {
      const { toRemove } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: 'Select entries to remove:',
          choices: profile.certifications.map((cert, i) => ({
            name: cert.name.value,
            value: i,
          })),
        },
      ])) as { toRemove: number[] };
      if (toRemove.length > 0) {
        const removeSet = new Set(toRemove);
        profile = {
          ...profile,
          certifications: profile.certifications.filter((_, i) => !removeSet.has(i)),
        };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`Removed ${toRemove.length} entry/entries.`)}`);
      }
      continue;
    }

    // cert:N — edit
    const certIdx = parseInt(action.split(':')[1], 10);
    const cert = profile.certifications[certIdx];

    const { name } = (await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Name:', default: cert.name.value },
    ])) as { name: string };
    const { authority } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'authority',
        message: 'Authority:',
        default: cert.authority?.value ?? '',
      },
    ])) as { authority: string };
    const { startDate } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'startDate',
        message: 'Date (YYYY-MM):',
        default: cert.startDate?.value ?? '',
      },
    ])) as { startDate: string };

    const newCert: Certification = {
      ...cert,
      name: userEdit(name.trim() || cert.name.value),
      authority: authority.trim() ? userEdit(authority.trim()) : cert.authority,
      startDate: startDate.trim() ? userEdit(startDate.trim()) : cert.startDate,
    };

    const newCerts = [...profile.certifications];
    newCerts[certIdx] = newCert;
    profile = { ...profile, certifications: newCerts };
    await persistProfile(profile, profileDir);
    console.log(`${c.ok} ${c.success('Certification updated.')}`);
  }
}

// ---------------------------------------------------------------------------
// Projects editor
// ---------------------------------------------------------------------------

async function runProjectsEditor(
  inquirer: Awaited<typeof import('inquirer')>['default'],
  profile: Profile,
  profileDir: string,
): Promise<Profile> {
  while (true) {
    console.log(`\n  ${c.header('── Projects ──')}\n`);

    const choices = profile.projects.map((proj, i) => ({
      name: proj.title.value,
      value: `proj:${i}`,
    }));

    const { action } = (await inquirer.prompt([
      {
        type: 'list',
        loop: false,
        name: 'action',
        message: 'Projects:',
        choices: [
          ...choices,
          { name: '+ Add entry', value: 'add' },
          ...(profile.projects.length > 0 ? [{ name: '− Remove entry', value: 'remove' }] : []),
          { name: c.muted('← Back'), value: 'back' },
        ],
      },
    ])) as { action: string };

    if (action === 'back') return profile;

    if (action === 'add') {
      const { title } = (await inquirer.prompt([
        { type: 'input', name: 'title', message: 'Project title (required):' },
      ])) as { title: string };
      if (!title.trim()) {
        console.log(c.muted('Title is required.'));
        continue;
      }

      const { description } = (await inquirer.prompt([
        { type: 'input', name: 'description', message: 'Description (optional):' },
      ])) as { description: string };
      const { url } = (await inquirer.prompt([
        { type: 'input', name: 'url', message: 'URL (optional):' },
      ])) as { url: string };
      const { startDate } = (await inquirer.prompt([
        { type: 'input', name: 'startDate', message: 'Start date (YYYY-MM, optional):' },
      ])) as { startDate: string };
      const { endDate } = (await inquirer.prompt([
        { type: 'input', name: 'endDate', message: 'End date (YYYY-MM, optional):' },
      ])) as { endDate: string };

      const newProj: Project = {
        id: `proj-${Date.now()}`,
        title: userEdit(title.trim()),
        description: description.trim() ? userEdit(description.trim()) : undefined,
        url: url.trim() ? userEdit(url.trim()) : undefined,
        startDate: startDate.trim() ? userEdit(startDate.trim()) : undefined,
        endDate: endDate.trim() ? userEdit(endDate.trim()) : undefined,
      };

      profile = { ...profile, projects: [...profile.projects, newProj] };
      await persistProfile(profile, profileDir);
      console.log(`${c.ok} ${c.success('Project added.')}`);
      continue;
    }

    if (action === 'remove') {
      const { toRemove } = (await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: 'Select entries to remove:',
          choices: profile.projects.map((proj, i) => ({
            name: proj.title.value,
            value: i,
          })),
        },
      ])) as { toRemove: number[] };
      if (toRemove.length > 0) {
        const removeSet = new Set(toRemove);
        profile = {
          ...profile,
          projects: profile.projects.filter((_, i) => !removeSet.has(i)),
        };
        await persistProfile(profile, profileDir);
        console.log(`${c.ok} ${c.success(`Removed ${toRemove.length} entry/entries.`)}`);
      }
      continue;
    }

    // proj:N — edit
    const projIdx = parseInt(action.split(':')[1], 10);
    const proj = profile.projects[projIdx];

    const { title } = (await inquirer.prompt([
      { type: 'input', name: 'title', message: 'Title:', default: proj.title.value },
    ])) as { title: string };
    const { description } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'description',
        message: 'Description:',
        default: proj.description?.value ?? '',
      },
    ])) as { description: string };
    const { url } = (await inquirer.prompt([
      { type: 'input', name: 'url', message: 'URL:', default: proj.url?.value ?? '' },
    ])) as { url: string };
    const { startDate } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'startDate',
        message: 'Start date (YYYY-MM):',
        default: proj.startDate?.value ?? '',
      },
    ])) as { startDate: string };
    const { endDate } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'endDate',
        message: 'End date (YYYY-MM):',
        default: proj.endDate?.value ?? '',
      },
    ])) as { endDate: string };

    const newProj: Project = {
      ...proj,
      title: userEdit(title.trim() || proj.title.value),
      description: description.trim() ? userEdit(description.trim()) : proj.description,
      url: url.trim() ? userEdit(url.trim()) : proj.url,
      startDate: startDate.trim() ? userEdit(startDate.trim()) : proj.startDate,
      endDate: endDate.trim() ? userEdit(endDate.trim()) : proj.endDate,
    };

    const newProjects = [...profile.projects];
    newProjects[projIdx] = newProj;
    profile = { ...profile, projects: newProjects };
    await persistProfile(profile, profileDir);
    console.log(`${c.ok} ${c.success('Project updated.')}`);
  }
}

// ---------------------------------------------------------------------------
// Main profile editor
// ---------------------------------------------------------------------------

export async function runProfileEditor(options: ProfileEditorOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  const profileDir = options.profileDir ?? 'output';

  let profile = await loadActiveProfile(profileDir);

  while (true) {
    console.log(`\n${c.header('── Profile Editor ──')}\n`);
    console.log(`  ${c.label('Profile:')} ${c.value(profile.contact.name.value)}`);
    console.log();

    const choices = [
      { value: 'summary', name: `Summary` },
      { value: 'experience', name: `Experience  (${profile.positions.length} positions)` },
      { value: 'skills', name: `Skills  (${profile.skills.length})` },
      { value: 'education', name: `Education  (${profile.education.length})` },
      ...(profile.certifications.length > 0
        ? [{ value: 'certifications', name: `Certifications  (${profile.certifications.length})` }]
        : []),
      ...(profile.projects.length > 0
        ? [{ value: 'projects', name: `Projects  (${profile.projects.length})` }]
        : []),
      { value: 'back', name: c.muted('← Back') },
    ];

    let section: string;
    try {
      const ans = (await inquirer.prompt([
        {
          type: 'list',
          loop: false,
          name: 'section',
          message: 'Edit section:',
          choices,
        },
      ])) as { section: string };
      section = ans.section;
    } catch (err) {
      if (isUserExit(err)) return;
      throw err;
    }

    if (section === 'back') return;

    if (section === 'summary') {
      profile = await runSummaryEditor(inquirer, profile, profileDir);
    } else if (section === 'experience') {
      profile = await runExperienceEditor(inquirer, profile, profileDir);
    } else if (section === 'skills') {
      profile = await runSkillsEditor(inquirer, profile, profileDir);
    } else if (section === 'education') {
      profile = await runEducationEditor(inquirer, profile, profileDir);
    } else if (section === 'certifications') {
      profile = await runCertificationsEditor(inquirer, profile, profileDir);
    } else if (section === 'projects') {
      profile = await runProjectsEditor(inquirer, profile, profileDir);
    }
  }
}
