import { createHash } from 'node:crypto';
import { callWithTool } from '../claude/client.ts';
import {
  PARSE_LINKEDIN_SYSTEM,
  type ParsedLinkedInProfile,
  parseLinkedInTool,
} from '../claude/prompts/parse-linkedin.ts';
import type { DataSource, Profile, Sourced } from '../profile/schema.ts';
import { deduplicateSkills, normalizeDate, splitBullets } from './normalizer.ts';

function makeSource(inputHash: string): DataSource {
  return { kind: 'linkedin-paste', extractedBy: 'claude', inputHash };
}

function s<T>(value: T, inputHash: string): Sourced<T> {
  return { value, source: makeSource(inputHash) };
}

export async function parseLinkedInPaste(
  pastedText: string,
  signal?: AbortSignal,
): Promise<Profile> {
  const now = new Date().toISOString();
  const inputHash = createHash('sha256').update(pastedText).digest('hex');

  const extracted = await callWithTool<ParsedLinkedInProfile>(
    PARSE_LINKEDIN_SYSTEM,
    `Please extract the profile data from this LinkedIn profile text:\n\n${pastedText}`,
    parseLinkedInTool,
    undefined,
    signal,
  );

  const positions = (extracted.positions ?? []).map((p, i) => {
    const descSourced = p.description ? s(p.description, inputHash) : undefined;
    const bullets = descSourced ? splitBullets(descSourced) : [];
    return {
      id: `pos-${i}`,
      title: s(p.title, inputHash),
      company: s(p.company, inputHash),
      location: p.location ? s(p.location, inputHash) : undefined,
      startDate: s(normalizeDate(p.startDate), inputHash),
      endDate: p.endDate ? s(normalizeDate(p.endDate), inputHash) : undefined,
      description: descSourced,
      bullets,
    };
  });

  const education = (extracted.education ?? []).map((e, i) => ({
    id: `edu-${i}`,
    institution: s(e.institution, inputHash),
    degree: e.degree ? s(e.degree, inputHash) : undefined,
    fieldOfStudy: e.fieldOfStudy ? s(e.fieldOfStudy, inputHash) : undefined,
    startDate: e.startDate ? s(normalizeDate(e.startDate), inputHash) : undefined,
    endDate: e.endDate ? s(normalizeDate(e.endDate), inputHash) : undefined,
    activities: e.activities ? s(e.activities, inputHash) : undefined,
    notes: e.notes ? s(e.notes, inputHash) : undefined,
  }));

  const rawSkills = (extracted.skills ?? []).map((name, i) => ({
    id: `skill-${i}`,
    name: s(name, inputHash),
  }));

  const certifications = (extracted.certifications ?? []).map((c, i) => ({
    id: `cert-${i}`,
    name: s(c.name, inputHash),
    authority: c.authority ? s(c.authority, inputHash) : undefined,
    startDate: c.date ? s(normalizeDate(c.date), inputHash) : undefined,
  }));

  const projects = (extracted.projects ?? []).map((p, i) => ({
    id: `proj-${i}`,
    title: s(p.title, inputHash),
    description: p.description ? s(p.description, inputHash) : undefined,
    url: p.url ? s(p.url, inputHash) : undefined,
  }));

  const publications = (extracted.publications ?? []).map((p, i) => ({
    id: `pub-${i}`,
    title: s(p.title, inputHash),
    publisher: p.publisher ? s(p.publisher, inputHash) : undefined,
    publishedOn: p.publishedOn ? s(normalizeDate(p.publishedOn), inputHash) : undefined,
    description: p.description ? s(p.description, inputHash) : undefined,
    url: p.url ? s(p.url, inputHash) : undefined,
  }));

  const languages = (extracted.languages ?? []).map((l, i) => ({
    id: `lang-${i}`,
    name: s(l.name, inputHash),
    proficiency: l.proficiency ? s(l.proficiency, inputHash) : undefined,
  }));

  const volunteer = (extracted.volunteer ?? []).map((v, i) => ({
    id: `vol-${i}`,
    organization: s(v.organization, inputHash),
    role: v.role ? s(v.role, inputHash) : undefined,
    cause: v.cause ? s(v.cause, inputHash) : undefined,
    startDate: v.startDate ? s(normalizeDate(v.startDate), inputHash) : undefined,
    endDate: v.endDate ? s(normalizeDate(v.endDate), inputHash) : undefined,
  }));

  return {
    schemaVersion: '1',
    createdAt: now,
    updatedAt: now,
    contact: {
      name: s(extracted.contact.name, inputHash),
      headline: extracted.contact.headline ? s(extracted.contact.headline, inputHash) : undefined,
      email: extracted.contact.email ? s(extracted.contact.email, inputHash) : undefined,
      phone: extracted.contact.phone ? s(extracted.contact.phone, inputHash) : undefined,
      location: extracted.contact.location ? s(extracted.contact.location, inputHash) : undefined,
      linkedin: extracted.contact.linkedin ? s(extracted.contact.linkedin, inputHash) : undefined,
      website: extracted.contact.website ? s(extracted.contact.website, inputHash) : undefined,
      github: extracted.contact.github ? s(extracted.contact.github, inputHash) : undefined,
    },
    summary: extracted.summary ? s(extracted.summary, inputHash) : undefined,
    positions,
    education,
    skills: deduplicateSkills(rawSkills),
    certifications,
    projects,
    publications,
    languages,
    volunteer,
    awards: [],
  };
}
