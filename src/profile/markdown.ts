/**
 * Profile ↔ Markdown serialization.
 *
 * Every sourced value is emitted with an inline <!-- src:{...} --> annotation.
 * The parser reads those annotations back and compares values to detect user edits.
 * Changed values are upgraded to { kind: 'user-edit', editedAt: now }.
 *
 * Sections handled for round-trip: contact (all fields), summary, experience
 * (titles, company, location, dates, all bullets), education (all fields),
 * skills (add/remove/rename), certifications, projects, languages, volunteer, awards.
 */

import { readFile, writeFile } from 'fs/promises';
import {
  Profile, Sourced, DataSource,
  Position, Education, Skill, Certification, Project, Language, VolunteerRole,
} from './schema.js';
import { deduplicateSkills } from '../ingestion/normalizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function src(source: DataSource): string {
  return `<!-- src:${JSON.stringify(source)} -->`;
}

function sf<T>(label: string, s: Sourced<T> | undefined): string {
  if (!s) return '';
  return `**${label}:** ${String(s.value)} ${src(s.source)}\n`;
}

const userEditSource = (now: string): DataSource => ({ kind: 'user-edit', editedAt: now });

function upgradeIfChanged<T>(parsed: T, original: Sourced<T> | undefined, now: string): Sourced<T> {
  if (!original) return { value: parsed, source: userEditSource(now) };
  if (String(parsed) !== String(original.value)) {
    return { value: parsed, source: userEditSource(now) };
  }
  return original;
}

// ---------------------------------------------------------------------------
// Profile → Markdown
// ---------------------------------------------------------------------------

export async function profileToMarkdown(profile: Profile, filePath: string): Promise<void> {
  const lines: string[] = [];

  lines.push('# Resume Profile\n\n');
  lines.push(`<!-- schemaVersion:${profile.schemaVersion} -->\n`);
  lines.push(`<!-- createdAt:${profile.createdAt} -->\n\n`);

  // Contact
  lines.push('## Contact\n\n');
  lines.push(sf('Name', profile.contact.name));
  lines.push(sf('Email', profile.contact.email));
  lines.push(sf('Phone', profile.contact.phone));
  lines.push(sf('Location', profile.contact.location));
  lines.push(sf('LinkedIn', profile.contact.linkedin));
  lines.push(sf('Website', profile.contact.website));
  lines.push(sf('GitHub', profile.contact.github));

  // Summary
  if (profile.summary) {
    lines.push('\n## Summary\n\n');
    lines.push(`${profile.summary.value} ${src(profile.summary.source)}\n`);
  }

  // Experience
  if (profile.positions.length > 0) {
    lines.push('\n## Experience\n');
    for (const pos of profile.positions) {
      lines.push(`\n<!-- pos-id:${pos.id} -->\n`);
      lines.push(`### ${pos.title.value} at ${pos.company.value}\n\n`);
      lines.push(sf('Title', pos.title));
      lines.push(sf('Company', pos.company));
      if (pos.location) lines.push(sf('Location', pos.location));
      lines.push(sf('Start Date', pos.startDate));
      if (pos.endDate) lines.push(sf('End Date', pos.endDate));
      if (pos.bullets.length > 0) {
        lines.push('\n**Bullets:**\n\n');
        for (const bullet of pos.bullets) {
          lines.push(`- ${bullet.value} ${src(bullet.source)}\n`);
        }
      }
    }
  }

  // Education
  if (profile.education.length > 0) {
    lines.push('\n## Education\n');
    for (const edu of profile.education) {
      lines.push(`\n<!-- edu-id:${edu.id} -->\n`);
      lines.push(`### ${edu.institution.value}\n\n`);
      lines.push(sf('Institution', edu.institution));
      if (edu.degree) lines.push(sf('Degree', edu.degree));
      if (edu.fieldOfStudy) lines.push(sf('Field of Study', edu.fieldOfStudy));
      if (edu.startDate) lines.push(sf('Start Date', edu.startDate));
      if (edu.endDate) lines.push(sf('End Date', edu.endDate));
      if (edu.activities) lines.push(sf('Activities', edu.activities));
      if (edu.notes) lines.push(sf('Notes', edu.notes));
    }
  }

  // Skills
  if (profile.skills.length > 0) {
    lines.push('\n## Skills\n\n');
    for (const skill of profile.skills) {
      lines.push(`<!-- skill-id:${skill.id} --> - ${skill.name.value} ${src(skill.name.source)}\n`);
    }
  }

  // Certifications
  if (profile.certifications.length > 0) {
    lines.push('\n## Certifications\n');
    for (const cert of profile.certifications) {
      lines.push(`\n<!-- cert-id:${cert.id} -->\n`);
      lines.push(`### ${cert.name.value}\n\n`);
      lines.push(sf('Name', cert.name));
      if (cert.authority) lines.push(sf('Authority', cert.authority));
      if (cert.startDate) lines.push(sf('Date', cert.startDate));
    }
  }

  // Projects
  if (profile.projects.length > 0) {
    lines.push('\n## Projects\n');
    for (const proj of profile.projects) {
      lines.push(`\n<!-- proj-id:${proj.id} -->\n`);
      lines.push(`### ${proj.title.value}\n\n`);
      lines.push(sf('Title', proj.title));
      if (proj.description) lines.push(sf('Description', proj.description));
      if (proj.url) lines.push(sf('URL', proj.url));
      if (proj.startDate) lines.push(sf('Start Date', proj.startDate));
      if (proj.endDate) lines.push(sf('End Date', proj.endDate));
    }
  }

  // Languages
  if (profile.languages.length > 0) {
    lines.push('\n## Languages\n\n');
    for (const lang of profile.languages) {
      lines.push(`<!-- lang-id:${lang.id} --> - ${lang.name.value}`);
      if (lang.proficiency) lines.push(` (${lang.proficiency.value})`);
      lines.push(` ${src(lang.name.source)}\n`);
    }
  }

  // Volunteer
  if (profile.volunteer.length > 0) {
    lines.push('\n## Volunteer\n');
    for (const vol of profile.volunteer) {
      lines.push(`\n<!-- vol-id:${vol.id} -->\n`);
      lines.push(`### ${vol.organization.value}\n\n`);
      lines.push(sf('Organization', vol.organization));
      if (vol.role) lines.push(sf('Role', vol.role));
      if (vol.cause) lines.push(sf('Cause', vol.cause));
      if (vol.startDate) lines.push(sf('Start Date', vol.startDate));
      if (vol.endDate) lines.push(sf('End Date', vol.endDate));
    }
  }

  // Awards
  if (profile.awards.length > 0) {
    lines.push('\n## Awards\n\n');
    for (const award of profile.awards) {
      lines.push(`- ${award.value} ${src(award.source)}\n`);
    }
  }

  await writeFile(filePath, lines.filter(Boolean).join(''), 'utf-8');
}

// ---------------------------------------------------------------------------
// Markdown → Profile
// ---------------------------------------------------------------------------

type Section =
  | 'contact' | 'summary' | 'experience' | 'education'
  | 'skills' | 'certifications' | 'projects' | 'languages'
  | 'volunteer' | 'awards' | '';

interface ParsedField {
  label: string;
  value: string;
  source: DataSource;
}

/** Extract `**Label:** value <!-- src:{...} -->` from a line */
function parseField(line: string): ParsedField | null {
  const m = line.match(/^\*\*([^*]+):\*\*\s+(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
  if (!m) return null;
  try {
    return { label: m[1], value: m[2].trim(), source: JSON.parse(m[3]) as DataSource };
  } catch {
    return null;
  }
}

/** Extract inline item `- value <!-- src:{...} -->` from a line */
function parseInlineItem(line: string): { value: string; source: DataSource } | null {
  const m = line.match(/^(?:<!--[^>]*-->\s*)?-\s+(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
  if (!m) return null;
  try {
    return { value: m[1].trim(), source: JSON.parse(m[2]) as DataSource };
  } catch {
    return null;
  }
}

/** Extract `<!-- key:value -->` from a line */
function parseMetaComment(line: string, key: string): string | null {
  const m = line.match(new RegExp(`<!--\\s*${key}:([^\\s>]+)\\s*-->`));
  return m ? m[1] : null;
}

export async function markdownToProfile(mdPath: string, originalProfile: Profile): Promise<Profile> {
  const md = await readFile(mdPath, 'utf-8');
  const now = new Date().toISOString();
  const up = (v: string, orig: Sourced<string> | undefined) => upgradeIfChanged(v, orig, now);

  const lines = md.split('\n');

  // Working state
  let section: Section = '';
  let currentPosId: string | null = null;
  let currentEduId: string | null = null;
  let currentCertId: string | null = null;
  let currentProjId: string | null = null;
  let currentVolId: string | null = null;
  let inBullets = false;
  let bulletIdx = 0;

  // Rebuilt collections — these replace originals if parsed
  const posMap = new Map<string, Position>();
  // Pre-populate with clones so untouched positions are preserved
  for (const pos of originalProfile.positions) {
    posMap.set(pos.id, structuredClone(pos) as Position);
  }
  const eduMap = new Map<string, Education>();
  for (const edu of originalProfile.education) {
    eduMap.set(edu.id, structuredClone(edu) as Education);
  }
  const certMap = new Map<string, Certification>();
  for (const cert of originalProfile.certifications) {
    certMap.set(cert.id, structuredClone(cert) as Certification);
  }
  const projMap = new Map<string, Project>();
  for (const proj of originalProfile.projects) {
    projMap.set(proj.id, structuredClone(proj) as Project);
  }
  const volMap = new Map<string, VolunteerRole>();
  for (const vol of originalProfile.volunteer) {
    volMap.set(vol.id, structuredClone(vol) as VolunteerRole);
  }

  const parsedSkills: Skill[] = [];
  const parsedAwards: Sourced<string>[] = [];
  const parsedLangs: Language[] = [];
  let parsedSummary: Sourced<string> | undefined = originalProfile.summary
    ? structuredClone(originalProfile.summary)
    : undefined;

  // Contact (clone, then overwrite fields as we parse)
  const contact = structuredClone(originalProfile.contact);

  let skillCounter = 0;
  let langCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Section detection
    if (/^## Contact/.test(line)) { section = 'contact'; continue; }
    if (/^## Summary/.test(line)) { section = 'summary'; continue; }
    if (/^## Experience/.test(line)) { section = 'experience'; currentPosId = null; inBullets = false; continue; }
    if (/^## Education/.test(line)) { section = 'education'; currentEduId = null; continue; }
    if (/^## Skills/.test(line)) { section = 'skills'; continue; }
    if (/^## Certifications/.test(line)) { section = 'certifications'; currentCertId = null; continue; }
    if (/^## Projects/.test(line)) { section = 'projects'; currentProjId = null; continue; }
    if (/^## Languages/.test(line)) { section = 'languages'; continue; }
    if (/^## Volunteer/.test(line)) { section = 'volunteer'; currentVolId = null; continue; }
    if (/^## Awards/.test(line)) { section = 'awards'; continue; }

    // Skip blank lines
    if (!line) continue;

    // --- Contact section ---
    if (section === 'contact') {
      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Name':     contact.name = up(f.value, contact.name); break;
        case 'Email':    contact.email = contact.email ? up(f.value, contact.email) : { value: f.value, source: f.source }; break;
        case 'Phone':    contact.phone = contact.phone ? up(f.value, contact.phone) : { value: f.value, source: f.source }; break;
        case 'Location': contact.location = contact.location ? up(f.value, contact.location) : { value: f.value, source: f.source }; break;
        case 'LinkedIn': contact.linkedin = contact.linkedin ? up(f.value, contact.linkedin) : { value: f.value, source: f.source }; break;
        case 'Website':  contact.website = contact.website ? up(f.value, contact.website) : { value: f.value, source: f.source }; break;
        case 'GitHub':   contact.github = contact.github ? up(f.value, contact.github) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Summary section ---
    if (section === 'summary') {
      const m = line.match(/^(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
      if (m) {
        const text = m[1].trim();
        parsedSummary = up(text, parsedSummary);
      }
      continue;
    }

    // --- Experience section ---
    if (section === 'experience') {
      const posId = parseMetaComment(line, 'pos-id');
      if (posId) {
        currentPosId = posId;
        inBullets = false;
        bulletIdx = 0;
        // Ensure we have a clone in posMap
        if (!posMap.has(posId)) {
          const orig = originalProfile.positions.find(p => p.id === posId);
          if (orig) posMap.set(posId, structuredClone(orig) as Position);
        }
        continue;
      }
      if (line === '**Bullets:**') { inBullets = true; bulletIdx = 0; continue; }
      if (line.startsWith('### ')) { inBullets = false; bulletIdx = 0; continue; }

      if (!currentPosId) continue;
      const pos = posMap.get(currentPosId);
      if (!pos) continue;

      if (inBullets) {
        const item = parseInlineItem(line);
        if (item) {
          if (bulletIdx < pos.bullets.length) {
            pos.bullets[bulletIdx] = up(item.value, pos.bullets[bulletIdx]);
          }
          bulletIdx++;
        }
        continue;
      }

      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Title':      pos.title = up(f.value, pos.title); break;
        case 'Company':    pos.company = up(f.value, pos.company); break;
        case 'Location':   pos.location = pos.location ? up(f.value, pos.location) : { value: f.value, source: f.source }; break;
        case 'Start Date': pos.startDate = up(f.value, pos.startDate); break;
        case 'End Date':   pos.endDate = pos.endDate ? up(f.value, pos.endDate) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Education section ---
    if (section === 'education') {
      const eduId = parseMetaComment(line, 'edu-id');
      if (eduId) {
        currentEduId = eduId;
        if (!eduMap.has(eduId)) {
          const orig = originalProfile.education.find(e => e.id === eduId);
          if (orig) eduMap.set(eduId, structuredClone(orig) as Education);
        }
        continue;
      }
      if (!currentEduId || line.startsWith('### ')) continue;
      const edu = eduMap.get(currentEduId);
      if (!edu) continue;

      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Institution':    edu.institution = up(f.value, edu.institution); break;
        case 'Degree':         edu.degree = edu.degree ? up(f.value, edu.degree) : { value: f.value, source: f.source }; break;
        case 'Field of Study': edu.fieldOfStudy = edu.fieldOfStudy ? up(f.value, edu.fieldOfStudy) : { value: f.value, source: f.source }; break;
        case 'Start Date':     edu.startDate = edu.startDate ? up(f.value, edu.startDate) : { value: f.value, source: f.source }; break;
        case 'End Date':       edu.endDate = edu.endDate ? up(f.value, edu.endDate) : { value: f.value, source: f.source }; break;
        case 'Activities':     edu.activities = edu.activities ? up(f.value, edu.activities) : { value: f.value, source: f.source }; break;
        case 'Notes':          edu.notes = edu.notes ? up(f.value, edu.notes) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Skills section ---
    if (section === 'skills') {
      // Format: <!-- skill-id:skill-0 --> - Skill Name <!-- src:{...} -->
      const idMatch = line.match(/<!--\s*skill-id:([^\s>]+)\s*-->/);
      const item = parseInlineItem(line);
      if (item) {
        const origSkillId = idMatch?.[1];
        const origSkill = originalProfile.skills.find(s => s.id === origSkillId);
        const skillId = origSkillId ?? `skill-${skillCounter++}`;
        parsedSkills.push({
          id: skillId,
          name: up(item.value, origSkill?.name),
        });
      }
      continue;
    }

    // --- Certifications section ---
    if (section === 'certifications') {
      const certId = parseMetaComment(line, 'cert-id');
      if (certId) {
        currentCertId = certId;
        if (!certMap.has(certId)) {
          const orig = originalProfile.certifications.find(c => c.id === certId);
          if (orig) certMap.set(certId, structuredClone(orig) as Certification);
        }
        continue;
      }
      if (!currentCertId || line.startsWith('### ')) continue;
      const cert = certMap.get(currentCertId);
      if (!cert) continue;

      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Name':      cert.name = up(f.value, cert.name); break;
        case 'Authority': cert.authority = cert.authority ? up(f.value, cert.authority) : { value: f.value, source: f.source }; break;
        case 'Date':      cert.startDate = cert.startDate ? up(f.value, cert.startDate) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Projects section ---
    if (section === 'projects') {
      const projId = parseMetaComment(line, 'proj-id');
      if (projId) {
        currentProjId = projId;
        if (!projMap.has(projId)) {
          const orig = originalProfile.projects.find(p => p.id === projId);
          if (orig) projMap.set(projId, structuredClone(orig) as Project);
        }
        continue;
      }
      if (!currentProjId || line.startsWith('### ')) continue;
      const proj = projMap.get(currentProjId);
      if (!proj) continue;

      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Title':       proj.title = up(f.value, proj.title); break;
        case 'Description': proj.description = proj.description ? up(f.value, proj.description) : { value: f.value, source: f.source }; break;
        case 'URL':         proj.url = proj.url ? up(f.value, proj.url) : { value: f.value, source: f.source }; break;
        case 'Start Date':  proj.startDate = proj.startDate ? up(f.value, proj.startDate) : { value: f.value, source: f.source }; break;
        case 'End Date':    proj.endDate = proj.endDate ? up(f.value, proj.endDate) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Languages section ---
    if (section === 'languages') {
      const idMatch = line.match(/<!--\s*lang-id:([^\s>]+)\s*-->/);
      // Format: <!-- lang-id:lang-0 --> - Name (Proficiency) <!-- src:{...} -->
      const item = parseInlineItem(line);
      if (item) {
        const origLangId = idMatch?.[1];
        const origLang = originalProfile.languages.find(l => l.id === origLangId);
        // Split "(Proficiency)" if present
        const profMatch = item.value.match(/^(.*?)\s*\(([^)]+)\)$/);
        const nameVal = profMatch ? profMatch[1].trim() : item.value;
        const profVal = profMatch ? profMatch[2] : undefined;
        const langId = origLangId ?? `lang-${langCounter++}`;
        const lang: Language = {
          id: langId,
          name: up(nameVal, origLang?.name),
          proficiency: profVal
            ? (origLang?.proficiency ? up(profVal, origLang.proficiency) : { value: profVal, source: item.source })
            : undefined,
        };
        parsedLangs.push(lang);
      }
      continue;
    }

    // --- Volunteer section ---
    if (section === 'volunteer') {
      const volId = parseMetaComment(line, 'vol-id');
      if (volId) {
        currentVolId = volId;
        if (!volMap.has(volId)) {
          const orig = originalProfile.volunteer.find(v => v.id === volId);
          if (orig) volMap.set(volId, structuredClone(orig) as VolunteerRole);
        }
        continue;
      }
      if (!currentVolId || line.startsWith('### ')) continue;
      const vol = volMap.get(currentVolId);
      if (!vol) continue;

      const f = parseField(line);
      if (!f) continue;
      switch (f.label) {
        case 'Organization': vol.organization = up(f.value, vol.organization); break;
        case 'Role':         vol.role = vol.role ? up(f.value, vol.role) : { value: f.value, source: f.source }; break;
        case 'Cause':        vol.cause = vol.cause ? up(f.value, vol.cause) : { value: f.value, source: f.source }; break;
        case 'Start Date':   vol.startDate = vol.startDate ? up(f.value, vol.startDate) : { value: f.value, source: f.source }; break;
        case 'End Date':     vol.endDate = vol.endDate ? up(f.value, vol.endDate) : { value: f.value, source: f.source }; break;
      }
      continue;
    }

    // --- Awards section ---
    if (section === 'awards') {
      const item = parseInlineItem(line);
      if (item) {
        const origAward = originalProfile.awards.find(a => a.value === item.value);
        parsedAwards.push(origAward ?? { value: item.value, source: item.source });
      }
      continue;
    }
  }

  // Reassemble in original order (preserves ordering even if parser doesn't re-order)
  const positions = originalProfile.positions
    .filter(p => posMap.has(p.id))
    .map(p => posMap.get(p.id)!);

  const education = originalProfile.education
    .filter(e => eduMap.has(e.id))
    .map(e => eduMap.get(e.id)!);

  const certifications = originalProfile.certifications
    .filter(c => certMap.has(c.id))
    .map(c => certMap.get(c.id)!);

  const projects = originalProfile.projects
    .filter(p => projMap.has(p.id))
    .map(p => projMap.get(p.id)!);

  const volunteer = originalProfile.volunteer
    .filter(v => volMap.has(v.id))
    .map(v => volMap.get(v.id)!);

  // Skills: use parsed list if any were found, else keep originals
  const skills = parsedSkills.length > 0
    ? deduplicateSkills(parsedSkills)
    : originalProfile.skills;

  // Languages: use parsed if found, else keep originals
  const languages = parsedLangs.length > 0 ? parsedLangs : originalProfile.languages;

  // Awards: use parsed if found, else keep originals
  const awards = parsedAwards.length > 0 ? parsedAwards : originalProfile.awards;

  return {
    schemaVersion: '1',
    createdAt: originalProfile.createdAt,
    updatedAt: now,
    contact,
    summary: parsedSummary,
    positions,
    education,
    skills,
    certifications,
    projects,
    publications: originalProfile.publications, // not editable via MD
    languages,
    volunteer,
    awards,
  };
}
