/**
 * Parse a LinkedIn data export directory (CSV files) into a Profile.
 * No Claude — pure deterministic parsing. Every value is wrapped with
 * { kind: 'linkedin-export', file, field } provenance.
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import {
  Profile, DataSource, Sourced,
  Position, Education, Skill, Certification,
  Project, Publication, Language, VolunteerRole,
} from '../profile/schema.js';
import { normalizeDate, splitBullets, deduplicateSkills } from './normalizer.js';

type Row = Record<string, string>;

function src(file: string, field: string): DataSource {
  return { kind: 'linkedin-export', file, field };
}

function s<T>(value: T, file: string, field: string): Sourced<T> {
  return { value, source: src(file, field) };
}

async function readCsv(dir: string, filename: string): Promise<Row[]> {
  const path = join(dir, filename);
  try {
    const raw = await readFile(path, 'utf-8');
    // LinkedIn CSVs sometimes have BOM
    const cleaned = raw.replace(/^\uFEFF/, '');
    return csvParse(cleaned, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    }) as Row[];
  } catch {
    return [];
  }
}

function notEmpty(v: string | undefined): boolean {
  return !!v && v.trim() !== '';
}

function opt(row: Row, key: string, file: string): Sourced<string> | undefined {
  const v = row[key];
  return notEmpty(v) ? s(v.trim(), file, key) : undefined;
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

function parseContact(rows: Row[], file: string) {
  if (!rows.length) return null;
  const r = rows[0];
  return {
    name: s(`${r['First Name'] ?? ''} ${r['Last Name'] ?? ''}`.trim(), file, 'First Name + Last Name'),
    email: opt(r, 'Email Address', file),
    phone: opt(r, 'Phone Numbers', file),
    location: opt(r, 'Location', file) ?? opt(r, 'Geo Location', file),
    linkedin: opt(r, 'Public Profile Url', file),
    website: opt(r, 'Websites', file) ?? opt(r, 'Twitter Handles', file),
    github: undefined as Sourced<string> | undefined,
  };
}

function parsePositions(rows: Row[], file: string): Position[] {
  const result: Position[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = r['Title']?.trim() ?? '';
    const company = r['Company Name']?.trim() ?? r['Employer']?.trim() ?? '';

    if (!title || !company) {
      console.warn(`  ⚠  Positions.csv row ${i + 1}: missing Title or Company Name — skipping`);
      continue;
    }

    const rawDesc = r['Description'] ?? '';
    const descSourced: Sourced<string> | undefined = notEmpty(rawDesc)
      ? s(rawDesc.trim(), file, 'Description')
      : undefined;
    const bullets = descSourced ? splitBullets(descSourced) : [];

    const startRaw = r['Started On'] ?? r['Start Date'] ?? '';
    const endRaw = r['Finished On'] ?? r['End Date'] ?? '';

    if (!notEmpty(startRaw)) {
      console.warn(`  ⚠  Position "${title}" at "${company}": missing start date`);
    }

    result.push({
      id: `pos-${i}`,
      title: s(title, file, 'Title'),
      company: s(company, file, 'Company Name'),
      location: opt(r, 'Location', file),
      startDate: s(normalizeDate(startRaw || ''), file, 'Started On'),
      endDate: notEmpty(endRaw) ? s(normalizeDate(endRaw), file, 'Finished On') : undefined,
      description: descSourced,
      bullets,
    });
  }
  return result;
}

function parseEducation(rows: Row[], file: string): Education[] {
  return rows.map((r, i) => {
    const startRaw = r['Start Date'] ?? '';
    const endRaw = r['End Date'] ?? '';
    return {
      id: `edu-${i}`,
      institution: s(r['School Name']?.trim() ?? '', file, 'School Name'),
      degree: opt(r, 'Degree Name', file),
      fieldOfStudy: opt(r, 'Notes', file) ? undefined : opt(r, 'Field Of Study', file) ?? opt(r, 'Activities', file),
      startDate: notEmpty(startRaw) ? s(normalizeDate(startRaw), file, 'Start Date') : undefined,
      endDate: notEmpty(endRaw) ? s(normalizeDate(endRaw), file, 'End Date') : undefined,
      activities: opt(r, 'Activities', file),
      notes: opt(r, 'Notes', file),
    } satisfies Education;
  });
}

function parseSkills(rows: Row[], file: string): Skill[] {
  const raw: Skill[] = rows.map((r, i) => ({
    id: `skill-${i}`,
    name: s(r['Name']?.trim() ?? '', file, 'Name'),
  }));
  return deduplicateSkills(raw);
}

function parseCertifications(rows: Row[], file: string): Certification[] {
  return rows.map((r, i) => ({
    id: `cert-${i}`,
    name: s(r['Name']?.trim() ?? '', file, 'Name'),
    authority: opt(r, 'Authority', file),
    startDate: opt(r, 'Started On', file) ? s(normalizeDate(r['Started On']!), file, 'Started On') : undefined,
    endDate: opt(r, 'Finished On', file) ? s(normalizeDate(r['Finished On']!), file, 'Finished On') : undefined,
    licenseNumber: opt(r, 'License Number', file),
    url: opt(r, 'Url', file),
  } satisfies Certification));
}

function parseProjects(rows: Row[], file: string): Project[] {
  return rows.map((r, i) => ({
    id: `proj-${i}`,
    title: s(r['Title']?.trim() ?? '', file, 'Title'),
    description: opt(r, 'Description', file),
    url: opt(r, 'Url', file),
    startDate: opt(r, 'Started On', file) ? s(normalizeDate(r['Started On']!), file, 'Started On') : undefined,
    endDate: opt(r, 'Finished On', file) ? s(normalizeDate(r['Finished On']!), file, 'Finished On') : undefined,
  } satisfies Project));
}

function parsePublications(rows: Row[], file: string): Publication[] {
  return rows.map((r, i) => ({
    id: `pub-${i}`,
    title: s(r['Title']?.trim() ?? '', file, 'Title'),
    publisher: opt(r, 'Publisher', file),
    publishedOn: opt(r, 'Published On', file) ? s(normalizeDate(r['Published On']!), file, 'Published On') : undefined,
    description: opt(r, 'Description', file),
    url: opt(r, 'Url', file),
  } satisfies Publication));
}

function parseLanguages(rows: Row[], file: string): Language[] {
  return rows.map((r, i) => ({
    id: `lang-${i}`,
    name: s(r['Name']?.trim() ?? '', file, 'Name'),
    proficiency: opt(r, 'Proficiency', file),
  } satisfies Language));
}

function parseVolunteer(rows: Row[], file: string): VolunteerRole[] {
  return rows.map((r, i) => ({
    id: `vol-${i}`,
    organization: s(r['Organization']?.trim() ?? '', file, 'Organization'),
    role: opt(r, 'Role', file),
    cause: opt(r, 'Cause', file),
    startDate: opt(r, 'Started On', file) ? s(normalizeDate(r['Started On']!), file, 'Started On') : undefined,
    endDate: opt(r, 'Finished On', file) ? s(normalizeDate(r['Finished On']!), file, 'Finished On') : undefined,
    description: opt(r, 'Description', file),
  } satisfies VolunteerRole));
}

function parseAwards(rows: Row[], file: string): Sourced<string>[] {
  return rows
    .filter(r => notEmpty(r['Title']))
    .map(r => s(r['Title']!.trim(), file, 'Title'));
}

// ---------------------------------------------------------------------------
// Main export parser
// ---------------------------------------------------------------------------

export async function parseLinkedInExport(csvDir: string): Promise<Profile> {
  const now = new Date().toISOString();

  const [profileRows, posRows, eduRows, skillRows, certRows, projRows, pubRows, langRows, volRows, awardRows] =
    await Promise.all([
      readCsv(csvDir, 'Profile.csv'),
      readCsv(csvDir, 'Positions.csv'),
      readCsv(csvDir, 'Education.csv'),
      readCsv(csvDir, 'Skills.csv'),
      readCsv(csvDir, 'Certifications.csv'),
      readCsv(csvDir, 'Projects.csv'),
      readCsv(csvDir, 'Publications.csv'),
      readCsv(csvDir, 'Languages.csv'),
      readCsv(csvDir, 'Volunteer Causes.csv'),
      readCsv(csvDir, 'Honors & Awards.csv'),
    ]);

  const contact = parseContact(profileRows, 'Profile.csv');
  if (!contact) {
    throw new Error('Profile.csv not found or empty in LinkedIn export directory');
  }

  const summaryRaw = profileRows[0]?.['Summary'];
  const summary: Sourced<string> | undefined = notEmpty(summaryRaw)
    ? s(summaryRaw!.trim(), 'Profile.csv', 'Summary')
    : undefined;

  return {
    schemaVersion: '1',
    createdAt: now,
    updatedAt: now,
    contact,
    summary,
    positions: parsePositions(posRows, 'Positions.csv'),
    education: parseEducation(eduRows, 'Education.csv'),
    skills: parseSkills(skillRows, 'Skills.csv'),
    certifications: parseCertifications(certRows, 'Certifications.csv'),
    projects: parseProjects(projRows, 'Projects.csv'),
    publications: parsePublications(pubRows, 'Publications.csv'),
    languages: parseLanguages(langRows, 'Languages.csv'),
    volunteer: parseVolunteer(volRows, 'Volunteer Causes.csv'),
    awards: parseAwards(awardRows, 'Honors & Awards.csv'),
  };
}
