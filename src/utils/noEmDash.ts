import type {
  ConsultantFinding,
  JobEvaluation,
  ProfileEvaluation,
} from '../claude/prompts/consultant.ts';
import type { ResumeDocument } from '../profile/schema.ts';

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

/**
 * Replace Unicode em/en dashes and common em-dash HTML entities with ASCII hyphens.
 * Used so rendered resumes and consultant copy avoid U+2014/U+2013.
 */
export function replaceEmDashes(input: string): string {
  let s = input.split(EM_DASH).join(' - ');
  s = s.split(EN_DASH).join('-');
  s = s.replace(/&mdash;/gi, ' - ');
  s = s.replace(/&#8212;/g, ' - ');
  s = s.replace(/&#x2014;/gi, ' - ');
  return s;
}

function opt(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return replaceEmDashes(s);
}

/** Deep-copy and strip em dashes from every user-facing string in a resume document. */
export function sanitizeResumeDocument(doc: ResumeDocument): ResumeDocument {
  return {
    ...doc,
    contact: {
      ...doc.contact,
      name: replaceEmDashes(doc.contact.name),
      headline: opt(doc.contact.headline),
      email: opt(doc.contact.email),
      phone: opt(doc.contact.phone),
      location: opt(doc.contact.location),
      linkedin: opt(doc.contact.linkedin),
      website: opt(doc.contact.website),
      github: opt(doc.contact.github),
    },
    summary: opt(doc.summary),
    positions: doc.positions.map((p) => ({
      ...p,
      title: replaceEmDashes(p.title),
      company: replaceEmDashes(p.company),
      location: opt(p.location),
      startDate: replaceEmDashes(p.startDate),
      endDate: opt(p.endDate),
      bullets: p.bullets.map(replaceEmDashes),
    })),
    education: doc.education.map((e) => ({
      ...e,
      institution: replaceEmDashes(e.institution),
      degree: opt(e.degree),
      fieldOfStudy: opt(e.fieldOfStudy),
      startDate: opt(e.startDate),
      endDate: opt(e.endDate),
    })),
    skills: doc.skills.map(replaceEmDashes),
    projects: doc.projects.map((p) => ({
      title: replaceEmDashes(p.title),
      description: opt(p.description),
      url: opt(p.url),
    })),
    certifications: doc.certifications.map((c) => ({
      name: replaceEmDashes(c.name),
      authority: opt(c.authority),
      date: opt(c.date),
    })),
    languages: doc.languages.map((l) => ({
      name: replaceEmDashes(l.name),
      proficiency: opt(l.proficiency),
    })),
    volunteer: doc.volunteer.map((v) => ({
      organization: replaceEmDashes(v.organization),
      role: opt(v.role),
      startDate: opt(v.startDate),
      endDate: opt(v.endDate),
    })),
    awards: doc.awards.map(replaceEmDashes),
    jobTitle: replaceEmDashes(doc.jobTitle),
    company: replaceEmDashes(doc.company),
    generatedAt: replaceEmDashes(doc.generatedAt),
    logoDataUris: doc.logoDataUris
      ? Object.fromEntries(
          Object.entries(doc.logoDataUris).map(([k, v]) => [replaceEmDashes(k), v]),
        )
      : undefined,
  };
}

export function sanitizeProfileEvaluation(ev: ProfileEvaluation): ProfileEvaluation {
  return {
    overallScore: ev.overallScore,
    strengths: ev.strengths.map(replaceEmDashes),
    improvements: ev.improvements.map((f) => ({
      area: replaceEmDashes(f.area),
      issue: replaceEmDashes(f.issue),
      suggestion: replaceEmDashes(f.suggestion),
    })),
    verdict: replaceEmDashes(ev.verdict),
  };
}

export function sanitizeConsultantFindings(findings: ConsultantFinding[]): ConsultantFinding[] {
  return findings.map((f) => ({
    area: replaceEmDashes(f.area),
    issue: replaceEmDashes(f.issue),
    suggestion: replaceEmDashes(f.suggestion),
  }));
}

export function sanitizeJobEvaluation(ev: JobEvaluation): JobEvaluation {
  return {
    alignmentScore: ev.alignmentScore,
    strengths: ev.strengths.map(replaceEmDashes),
    gaps: ev.gaps.map((g) => ({
      area: replaceEmDashes(g.area),
      issue: replaceEmDashes(g.issue),
      suggestion: replaceEmDashes(g.suggestion),
    })),
    verdict: replaceEmDashes(ev.verdict),
  };
}
