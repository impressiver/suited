import { describe, expect, it } from 'vitest';
import type { ResumeDocument } from '../profile/schema.ts';
import { replaceEmDashes, sanitizeProfileEvaluation, sanitizeResumeDocument } from './noEmDash.ts';

describe('replaceEmDashes', () => {
  it('replaces Unicode em dash and entities', () => {
    expect(replaceEmDashes(`foo\u2014bar`)).toBe('foo - bar');
    expect(replaceEmDashes(`20\u201322`)).toBe('20-22');
    expect(replaceEmDashes('a&mdash;b')).toBe('a - b');
    expect(replaceEmDashes('x&#8212;y')).toBe('x - y');
    expect(replaceEmDashes('p&#x2014;q')).toBe('p - q');
  });
});

describe('sanitizeResumeDocument', () => {
  it('sanitizes nested strings', () => {
    const doc: ResumeDocument = {
      contact: { name: `A\u2014B` },
      positions: [
        {
          title: 'Eng',
          company: 'Co',
          startDate: '2020',
          bullets: [`one\u2014two`],
        },
      ],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      languages: [],
      volunteer: [],
      awards: [],
      flair: 3,
      template: 'classic',
      jobTitle: 'Role',
      company: 'Acme',
      generatedAt: 't',
    };
    const out = sanitizeResumeDocument(doc);
    expect(out.contact.name).toBe('A - B');
    expect(out.positions[0]?.bullets[0]).toBe('one - two');
  });
});

describe('sanitizeProfileEvaluation', () => {
  it('sanitizes all text fields', () => {
    const ev = sanitizeProfileEvaluation({
      overallScore: 7,
      strengths: [`good\u2014stuff`],
      improvements: [{ area: 'A', issue: `i\u2014x`, suggestion: `s\u2014g` }],
      verdict: `v\u2014d`,
    });
    expect(ev.strengths[0]).toBe('good - stuff');
    expect(ev.improvements[0]?.issue).toBe('i - x');
    expect(ev.verdict).toBe('v - d');
  });
});
