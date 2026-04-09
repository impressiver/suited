/**
 * Profile ↔ Markdown serialization.
 *
 * Every sourced value is emitted with an inline <!-- src:{...} --> annotation.
 * Block metadata (`<!-- pos-id -->`, `<!-- edu-id -->`, schema headers, etc.) is
 * internal. The TUI refined editor buffer is {@link stripHtmlCommentsFromProfileMarkdown}
 * (no `<!-- ... -->` in the field; comment-only physical lines are removed so there are no
 * blank “metadata” rows). The editor renders **one terminal cell per character** so caret,
 * mouse, and selection stay aligned. The read-only resume pane still uses lightweight hint
 * styling (dim/bold) without eliding characters.
 * Parse with {@link parseDisplayMarkdownStringToProfile}; save re-runs {@link profileMarkdownContent}
 * so comments and `src` tags are restored — diffing on-disk `refined.md` against the
 * in-memory display string shows metadata as the only structural addition.
 *
 * The canonical parser reads `src` annotations back and compares values to detect user edits.
 * Changed values are upgraded to { kind: 'user-edit', editedAt: now }.
 *
 * Sections handled for round-trip: contact (all fields), summary, experience
 * (titles, company, location, dates, all bullets), education (all fields),
 * skills (add/remove/rename), certifications, projects, languages, volunteer, awards.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { deduplicateSkills } from '../ingestion/normalizer.ts';
import type {
  Certification,
  DataSource,
  Education,
  Language,
  Position,
  Profile,
  Project,
  Skill,
  Sourced,
  VolunteerRole,
} from './schema.ts';

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

export function profileMarkdownContent(profile: Profile): string {
  const lines: string[] = [];

  lines.push('# Resume Profile\n\n');
  lines.push(`<!-- schemaVersion:${profile.schemaVersion} -->\n`);
  lines.push(`<!-- createdAt:${profile.createdAt} -->\n\n`);

  // Contact
  lines.push('## Contact\n\n');
  lines.push(sf('Name', profile.contact.name));
  lines.push(sf('Headline', profile.contact.headline));
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

  return lines.filter(Boolean).join('');
}

export async function profileToMarkdown(profile: Profile, filePath: string): Promise<void> {
  await writeFile(filePath, profileMarkdownContent(profile), 'utf-8');
}

// ---------------------------------------------------------------------------
// Markdown → Profile
// ---------------------------------------------------------------------------

type Section =
  | 'contact'
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'projects'
  | 'languages'
  | 'volunteer'
  | 'awards'
  | '';

interface ParsedField {
  label: string;
  value: string;
  source: DataSource;
}

/**
 * Remove `<!-- ... -->` metadata for the TUI editor.
 *
 * Physical lines that are **only** HTML comments (e.g. `<!-- pos-id:… -->`) are **dropped**
 * entirely so the buffer has no “hidden” rows — the caret and mouse map 1:1 to visible lines.
 * Lines that still contain text after stripping (inline `src`, etc.) are kept.
 */
export function stripHtmlCommentsFromProfileMarkdown(md: string): string {
  const normalized = md.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const HTML_COMMENT = /<!--[\s\S]*?-->/g;
  const HAS_COMMENT = /<!--[\s\S]*?-->/;
  const out: string[] = [];
  for (const row of normalized.split('\n')) {
    const hadHtmlComment = HAS_COMMENT.test(row);
    const without = row.replace(HTML_COMMENT, '').replace(/\s+$/, '');
    if (hadHtmlComment && without.trim() === '') {
      continue;
    }
    out.push(without);
  }
  return out.join('\n');
}

/** Extract `**Label:** value <!-- src:{...} -->` from a line */
function parseFieldStrict(line: string): ParsedField | null {
  const m = line.match(/^\*\*([^*]+):\*\*\s+(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
  if (!m) return null;
  try {
    return { label: m[1], value: m[2].trim(), source: JSON.parse(m[3]) as DataSource };
  } catch {
    return null;
  }
}

/** `**Label:** value` without provenance comment (TUI display markdown). */
function parseFieldDisplay(line: string, now: string): ParsedField | null {
  const m = line.match(/^\*\*([^*]+):\*\*\s+(.*)$/);
  if (!m) return null;
  return { label: m[1].trim(), value: m[2].trim(), source: userEditSource(now) };
}

function parseFieldFromLine(line: string, display: boolean, now: string): ParsedField | null {
  return display ? parseFieldDisplay(line, now) : parseFieldStrict(line);
}

/** Extract inline item `- value <!-- src:{...} -->` from a line */
function parseInlineItemStrict(line: string): { value: string; source: DataSource } | null {
  const m = line.match(/^(?:<!--[^>]*-->\s*)?-\s+(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
  if (!m) return null;
  try {
    return { value: m[1].trim(), source: JSON.parse(m[2]) as DataSource };
  } catch {
    return null;
  }
}

function parseInlineItemDisplay(
  line: string,
  now: string,
): { value: string; source: DataSource } | null {
  const m = line.trim().match(/^\s*-\s+(.+)$/);
  if (!m) return null;
  return { value: m[1].trim(), source: userEditSource(now) };
}

function parseInlineItemFromLine(
  line: string,
  display: boolean,
  now: string,
): { value: string; source: DataSource } | null {
  return display ? parseInlineItemDisplay(line, now) : parseInlineItemStrict(line);
}

/** `### Title at Company` heading body (emitted format for experience). */
function parseExperienceHeadingLine(line: string): { title: string; company: string } | null {
  const t = line.trim().replace(/^###\s+/, '');
  const at = t.lastIndexOf(' at ');
  if (at === -1) return null;
  const title = t.slice(0, at).trim();
  const company = t.slice(at + 4).trim();
  if (!title || !company) return null;
  return { title, company };
}

/** `### Institution` (education block start). */
function parseEducationHeadingLine(line: string): string | null {
  const m = line.trim().match(/^###\s+(.+)$/);
  return m?.[1]?.trim() ?? null;
}

/** Extract `<!-- key:value -->` from a line */
function parseMetaComment(line: string, key: string): string | null {
  const m = line.match(new RegExp(`<!--\\s*${key}:([^\\s>]+)\\s*-->`));
  return m ? m[1] : null;
}

/**
 * Parse resume markdown from a string (same rules as on-disk `refined.md`).
 * Use when the TUI holds markdown in memory instead of reading a temp file.
 */
export function parseMarkdownStringToProfile(md: string, originalProfile: Profile): Profile {
  return parseMarkdownBodyToProfile(md.split('\n'), originalProfile, false);
}

/**
 * Parse markdown shown in the TUI editor after {@link stripHtmlCommentsFromProfileMarkdown}
 * (no `<!-- ... -->` lines or inline comments). Re-serialize with {@link profileMarkdownContent}
 * to restore metadata on save.
 */
export function parseDisplayMarkdownStringToProfile(md: string, originalProfile: Profile): Profile {
  return parseMarkdownBodyToProfile(md.split('\n'), originalProfile, true);
}

export async function markdownToProfile(
  mdPath: string,
  originalProfile: Profile,
): Promise<Profile> {
  const md = await readFile(mdPath, 'utf-8');
  return parseMarkdownBodyToProfile(md.split('\n'), originalProfile, false);
}

function parseMarkdownBodyToProfile(
  lines: string[],
  originalProfile: Profile,
  display: boolean,
): Profile {
  const now = new Date().toISOString();
  const up = (v: string, orig: Sourced<string> | undefined) => upgradeIfChanged(v, orig, now);

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

  const experienceOrder: string[] = [];
  const educationOrder: string[] = [];
  const certificationsOrder: string[] = [];
  const projectsOrder: string[] = [];
  const volunteerOrder: string[] = [];
  let expBlockIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Section detection
    if (/^## Contact/.test(line)) {
      section = 'contact';
      continue;
    }
    if (/^## Summary/.test(line)) {
      section = 'summary';
      continue;
    }
    if (/^## Experience/.test(line)) {
      section = 'experience';
      currentPosId = null;
      inBullets = false;
      if (display) {
        experienceOrder.length = 0;
        expBlockIdx = -1;
      }
      continue;
    }
    if (/^## Education/.test(line)) {
      section = 'education';
      currentEduId = null;
      if (display) {
        educationOrder.length = 0;
      }
      continue;
    }
    if (/^## Skills/.test(line)) {
      section = 'skills';
      continue;
    }
    if (/^## Certifications/.test(line)) {
      section = 'certifications';
      currentCertId = null;
      if (display) {
        certificationsOrder.length = 0;
      }
      continue;
    }
    if (/^## Projects/.test(line)) {
      section = 'projects';
      currentProjId = null;
      if (display) {
        projectsOrder.length = 0;
      }
      continue;
    }
    if (/^## Languages/.test(line)) {
      section = 'languages';
      continue;
    }
    if (/^## Volunteer/.test(line)) {
      section = 'volunteer';
      currentVolId = null;
      if (display) {
        volunteerOrder.length = 0;
      }
      continue;
    }
    if (/^## Awards/.test(line)) {
      section = 'awards';
      continue;
    }

    // Skip blank lines
    if (!line) continue;

    // --- Contact section ---
    if (section === 'contact') {
      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Name':
          contact.name = up(f.value, contact.name);
          break;
        case 'Headline':
          contact.headline = contact.headline
            ? up(f.value, contact.headline)
            : { value: f.value, source: f.source };
          break;
        case 'Email':
          contact.email = contact.email
            ? up(f.value, contact.email)
            : { value: f.value, source: f.source };
          break;
        case 'Phone':
          contact.phone = contact.phone
            ? up(f.value, contact.phone)
            : { value: f.value, source: f.source };
          break;
        case 'Location':
          contact.location = contact.location
            ? up(f.value, contact.location)
            : { value: f.value, source: f.source };
          break;
        case 'LinkedIn':
          contact.linkedin = contact.linkedin
            ? up(f.value, contact.linkedin)
            : { value: f.value, source: f.source };
          break;
        case 'Website':
          contact.website = contact.website
            ? up(f.value, contact.website)
            : { value: f.value, source: f.source };
          break;
        case 'GitHub':
          contact.github = contact.github
            ? up(f.value, contact.github)
            : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Summary section ---
    if (section === 'summary') {
      if (display) {
        parsedSummary = up(line, parsedSummary);
      } else {
        const m = line.match(/^(.*?)\s+<!--\s*src:(\{.*?\})\s*-->/);
        if (m) {
          const text = m[1].trim();
          parsedSummary = up(text, parsedSummary);
        }
      }
      continue;
    }

    // --- Experience section ---
    if (section === 'experience') {
      if (!display) {
        const posId = parseMetaComment(line, 'pos-id');
        if (posId) {
          currentPosId = posId;
          inBullets = false;
          bulletIdx = 0;
          // Ensure we have a clone in posMap
          if (!posMap.has(posId)) {
            const orig = originalProfile.positions.find((p) => p.id === posId);
            if (orig) posMap.set(posId, structuredClone(orig) as Position);
          }
          continue;
        }
      }
      if (line === '**Bullets:**') {
        inBullets = true;
        bulletIdx = 0;
        continue;
      }
      if (line.startsWith('### ')) {
        if (display) {
          expBlockIdx++;
          const ph = parseExperienceHeadingLine(line);
          let id: string | undefined;
          if (ph) {
            const found = originalProfile.positions.find(
              (p) => p.title.value === ph.title && p.company.value === ph.company,
            );
            id = found?.id;
          }
          if (!id) {
            id =
              originalProfile.positions[expBlockIdx]?.id ??
              `pos-new-${expBlockIdx}-${skillCounter++}`;
          }
          currentPosId = id;
          if (!posMap.has(id)) {
            const origByIdx = originalProfile.positions[expBlockIdx];
            if (origByIdx?.id === id) {
              posMap.set(id, structuredClone(origByIdx) as Position);
            } else if (ph) {
              posMap.set(id, {
                id,
                title: { value: ph.title, source: userEditSource(now) },
                company: { value: ph.company, source: userEditSource(now) },
                startDate: { value: '', source: userEditSource(now) },
                bullets: [],
              });
            } else {
              posMap.set(id, {
                id,
                title: { value: 'Title', source: userEditSource(now) },
                company: { value: 'Company', source: userEditSource(now) },
                startDate: { value: '', source: userEditSource(now) },
                bullets: [],
              });
            }
          }
          experienceOrder.push(id);
        }
        inBullets = false;
        bulletIdx = 0;
        continue;
      }

      if (!currentPosId) continue;
      const pos = posMap.get(currentPosId);
      if (!pos) continue;

      if (inBullets) {
        const item = parseInlineItemFromLine(line, display, now);
        if (item) {
          if (bulletIdx < pos.bullets.length) {
            pos.bullets[bulletIdx] = up(item.value, pos.bullets[bulletIdx]);
          } else if (display) {
            pos.bullets.push({ value: item.value, source: item.source });
          }
          bulletIdx++;
        }
        continue;
      }

      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Title':
          pos.title = up(f.value, pos.title);
          break;
        case 'Company':
          pos.company = up(f.value, pos.company);
          break;
        case 'Location':
          pos.location = pos.location
            ? up(f.value, pos.location)
            : { value: f.value, source: f.source };
          break;
        case 'Start Date':
          pos.startDate = up(f.value, pos.startDate);
          break;
        case 'End Date':
          pos.endDate = pos.endDate
            ? up(f.value, pos.endDate)
            : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Education section ---
    if (section === 'education') {
      if (display) {
        if (line.startsWith('### ')) {
          const inst = parseEducationHeadingLine(line);
          if (inst) {
            const found = originalProfile.education.find((e) => e.institution.value === inst);
            const id =
              found?.id ??
              originalProfile.education[educationOrder.length]?.id ??
              `edu-new-${educationOrder.length}`;
            currentEduId = id;
            if (!eduMap.has(id)) {
              const origByIdx = originalProfile.education[educationOrder.length];
              if (found) {
                eduMap.set(id, structuredClone(found) as Education);
              } else if (origByIdx?.id === id) {
                eduMap.set(id, structuredClone(origByIdx) as Education);
              } else {
                eduMap.set(id, {
                  id,
                  institution: { value: inst, source: userEditSource(now) },
                });
              }
            }
            educationOrder.push(id);
          }
          continue;
        }
      } else {
        const eduId = parseMetaComment(line, 'edu-id');
        if (eduId) {
          currentEduId = eduId;
          if (!eduMap.has(eduId)) {
            const orig = originalProfile.education.find((e) => e.id === eduId);
            if (orig) eduMap.set(eduId, structuredClone(orig) as Education);
          }
          continue;
        }
      }
      if (!currentEduId || line.startsWith('### ')) continue;
      const edu = eduMap.get(currentEduId);
      if (!edu) continue;

      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Institution':
          edu.institution = up(f.value, edu.institution);
          break;
        case 'Degree':
          edu.degree = edu.degree ? up(f.value, edu.degree) : { value: f.value, source: f.source };
          break;
        case 'Field of Study':
          edu.fieldOfStudy = edu.fieldOfStudy
            ? up(f.value, edu.fieldOfStudy)
            : { value: f.value, source: f.source };
          break;
        case 'Start Date':
          edu.startDate = edu.startDate
            ? up(f.value, edu.startDate)
            : { value: f.value, source: f.source };
          break;
        case 'End Date':
          edu.endDate = edu.endDate
            ? up(f.value, edu.endDate)
            : { value: f.value, source: f.source };
          break;
        case 'Activities':
          edu.activities = edu.activities
            ? up(f.value, edu.activities)
            : { value: f.value, source: f.source };
          break;
        case 'Notes':
          edu.notes = edu.notes ? up(f.value, edu.notes) : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Skills section ---
    if (section === 'skills') {
      const idMatch = display ? null : line.match(/<!--\s*skill-id:([^\s>]+)\s*-->/);
      const item = parseInlineItemFromLine(line, display, now);
      if (item) {
        const origSkillId = idMatch?.[1];
        const origSkill = display
          ? originalProfile.skills[parsedSkills.length]
          : originalProfile.skills.find((s) => s.id === origSkillId);
        const skillId = origSkillId ?? origSkill?.id ?? `skill-${skillCounter++}`;
        parsedSkills.push({
          id: skillId,
          name: up(item.value, origSkill?.name),
        });
      }
      continue;
    }

    // --- Certifications section ---
    if (section === 'certifications') {
      if (display) {
        if (line.startsWith('### ')) {
          const title = parseEducationHeadingLine(line);
          if (title) {
            const found = originalProfile.certifications.find((c) => c.name.value === title);
            const id =
              found?.id ??
              originalProfile.certifications[certificationsOrder.length]?.id ??
              `cert-new-${certificationsOrder.length}`;
            currentCertId = id;
            if (!certMap.has(id)) {
              const origByIdx = originalProfile.certifications[certificationsOrder.length];
              if (found) {
                certMap.set(id, structuredClone(found) as Certification);
              } else if (origByIdx?.id === id) {
                certMap.set(id, structuredClone(origByIdx) as Certification);
              } else {
                certMap.set(id, {
                  id,
                  name: { value: title, source: userEditSource(now) },
                });
              }
            }
            certificationsOrder.push(id);
          }
          continue;
        }
      } else {
        const certId = parseMetaComment(line, 'cert-id');
        if (certId) {
          currentCertId = certId;
          if (!certMap.has(certId)) {
            const orig = originalProfile.certifications.find((c) => c.id === certId);
            if (orig) certMap.set(certId, structuredClone(orig) as Certification);
          }
          continue;
        }
      }
      if (!currentCertId || line.startsWith('### ')) continue;
      const cert = certMap.get(currentCertId);
      if (!cert) continue;

      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Name':
          cert.name = up(f.value, cert.name);
          break;
        case 'Authority':
          cert.authority = cert.authority
            ? up(f.value, cert.authority)
            : { value: f.value, source: f.source };
          break;
        case 'Date':
          cert.startDate = cert.startDate
            ? up(f.value, cert.startDate)
            : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Projects section ---
    if (section === 'projects') {
      if (display) {
        if (line.startsWith('### ')) {
          const title = parseEducationHeadingLine(line);
          if (title) {
            const found = originalProfile.projects.find((p) => p.title.value === title);
            const id =
              found?.id ??
              originalProfile.projects[projectsOrder.length]?.id ??
              `proj-new-${projectsOrder.length}`;
            currentProjId = id;
            if (!projMap.has(id)) {
              const origByIdx = originalProfile.projects[projectsOrder.length];
              if (found) {
                projMap.set(id, structuredClone(found) as Project);
              } else if (origByIdx?.id === id) {
                projMap.set(id, structuredClone(origByIdx) as Project);
              } else {
                projMap.set(id, {
                  id,
                  title: { value: title, source: userEditSource(now) },
                });
              }
            }
            projectsOrder.push(id);
          }
          continue;
        }
      } else {
        const projId = parseMetaComment(line, 'proj-id');
        if (projId) {
          currentProjId = projId;
          if (!projMap.has(projId)) {
            const orig = originalProfile.projects.find((p) => p.id === projId);
            if (orig) projMap.set(projId, structuredClone(orig) as Project);
          }
          continue;
        }
      }
      if (!currentProjId || line.startsWith('### ')) continue;
      const proj = projMap.get(currentProjId);
      if (!proj) continue;

      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Title':
          proj.title = up(f.value, proj.title);
          break;
        case 'Description':
          proj.description = proj.description
            ? up(f.value, proj.description)
            : { value: f.value, source: f.source };
          break;
        case 'URL':
          proj.url = proj.url ? up(f.value, proj.url) : { value: f.value, source: f.source };
          break;
        case 'Start Date':
          proj.startDate = proj.startDate
            ? up(f.value, proj.startDate)
            : { value: f.value, source: f.source };
          break;
        case 'End Date':
          proj.endDate = proj.endDate
            ? up(f.value, proj.endDate)
            : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Languages section ---
    if (section === 'languages') {
      const idMatch = display ? null : line.match(/<!--\s*lang-id:([^\s>]+)\s*-->/);
      const item = parseInlineItemFromLine(line, display, now);
      if (item) {
        const origLangId = idMatch?.[1];
        const origLang = display
          ? originalProfile.languages[parsedLangs.length]
          : originalProfile.languages.find((l) => l.id === origLangId);
        // Split "(Proficiency)" if present
        const profMatch = item.value.match(/^(.*?)\s*\(([^)]+)\)$/);
        const nameVal = profMatch ? profMatch[1].trim() : item.value;
        const profVal = profMatch ? profMatch[2] : undefined;
        const langId = origLangId ?? origLang?.id ?? `lang-${langCounter++}`;
        const lang: Language = {
          id: langId,
          name: up(nameVal, origLang?.name),
          proficiency: profVal
            ? origLang?.proficiency
              ? up(profVal, origLang.proficiency)
              : { value: profVal, source: item.source }
            : undefined,
        };
        parsedLangs.push(lang);
      }
      continue;
    }

    // --- Volunteer section ---
    if (section === 'volunteer') {
      if (display) {
        if (line.startsWith('### ')) {
          const org = parseEducationHeadingLine(line);
          if (org) {
            const found = originalProfile.volunteer.find((v) => v.organization.value === org);
            const id =
              found?.id ??
              originalProfile.volunteer[volunteerOrder.length]?.id ??
              `vol-new-${volunteerOrder.length}`;
            currentVolId = id;
            if (!volMap.has(id)) {
              const origByIdx = originalProfile.volunteer[volunteerOrder.length];
              if (found) {
                volMap.set(id, structuredClone(found) as VolunteerRole);
              } else if (origByIdx?.id === id) {
                volMap.set(id, structuredClone(origByIdx) as VolunteerRole);
              } else {
                volMap.set(id, {
                  id,
                  organization: { value: org, source: userEditSource(now) },
                });
              }
            }
            volunteerOrder.push(id);
          }
          continue;
        }
      } else {
        const volId = parseMetaComment(line, 'vol-id');
        if (volId) {
          currentVolId = volId;
          if (!volMap.has(volId)) {
            const orig = originalProfile.volunteer.find((v) => v.id === volId);
            if (orig) volMap.set(volId, structuredClone(orig) as VolunteerRole);
          }
          continue;
        }
      }
      if (!currentVolId || line.startsWith('### ')) continue;
      const vol = volMap.get(currentVolId);
      if (!vol) continue;

      const f = parseFieldFromLine(line, display, now);
      if (!f) continue;
      switch (f.label) {
        case 'Organization':
          vol.organization = up(f.value, vol.organization);
          break;
        case 'Role':
          vol.role = vol.role ? up(f.value, vol.role) : { value: f.value, source: f.source };
          break;
        case 'Cause':
          vol.cause = vol.cause ? up(f.value, vol.cause) : { value: f.value, source: f.source };
          break;
        case 'Start Date':
          vol.startDate = vol.startDate
            ? up(f.value, vol.startDate)
            : { value: f.value, source: f.source };
          break;
        case 'End Date':
          vol.endDate = vol.endDate
            ? up(f.value, vol.endDate)
            : { value: f.value, source: f.source };
          break;
      }
      continue;
    }

    // --- Awards section ---
    if (section === 'awards') {
      const item = parseInlineItemFromLine(line, display, now);
      if (item) {
        const origAward = originalProfile.awards.find((a) => a.value === item.value);
        parsedAwards.push(origAward ?? { value: item.value, source: item.source });
      }
    }
  }

  const positions = display
    ? experienceOrder.map((id) => posMap.get(id)).filter((p): p is Position => p !== undefined)
    : originalProfile.positions
        .map((p) => posMap.get(p.id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const education = display
    ? educationOrder.map((id) => eduMap.get(id)).filter((e): e is Education => e !== undefined)
    : originalProfile.education
        .map((e) => eduMap.get(e.id))
        .filter((e): e is NonNullable<typeof e> => e !== undefined);

  const certifications = display
    ? certificationsOrder
        .map((id) => certMap.get(id))
        .filter((c): c is Certification => c !== undefined)
    : originalProfile.certifications
        .map((c) => certMap.get(c.id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const projects = display
    ? projectsOrder.map((id) => projMap.get(id)).filter((p): p is Project => p !== undefined)
    : originalProfile.projects
        .map((p) => projMap.get(p.id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const volunteer = display
    ? volunteerOrder.map((id) => volMap.get(id)).filter((v): v is VolunteerRole => v !== undefined)
    : originalProfile.volunteer
        .map((v) => volMap.get(v.id))
        .filter((v): v is NonNullable<typeof v> => v !== undefined);

  // Skills: use parsed list if any were found, else keep originals
  const skills = parsedSkills.length > 0 ? deduplicateSkills(parsedSkills) : originalProfile.skills;

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
