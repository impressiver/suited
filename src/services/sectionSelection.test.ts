import { describe, expect, it } from 'vitest';
import type { ResumeDocument } from '../profile/schema.ts';
import {
  applyResumeSectionSelection,
  MIN_VISIBLE_RESUME_POSITIONS,
  selectAllSections,
} from './sectionSelection.ts';

describe('selectAllSections', () => {
  it('keeps all sections when every key is selected', () => {
    const doc: ResumeDocument = {
      contact: {
        name: 'A',
        headline: 'H',
      },
      summary: 'sum',
      positions: [
        {
          title: 'T',
          company: 'C',
          startDate: '2020',
          endDate: undefined,
          bullets: ['b'],
        },
      ],
      education: [],
      skills: ['s'],
      projects: [],
      certifications: [],
      languages: [],
      volunteer: [],
      awards: [],
      flair: 3,
      template: 'modern',
      jobTitle: 'J',
      company: 'Co',
      generatedAt: new Date().toISOString(),
    };
    const { doc: out, selected } = selectAllSections(doc);
    expect(selected).toContain('summary');
    expect(selected).toContain('pos:0');
    expect(selected).toContain('skills');
    expect(out.summary).toBe('sum');
    expect(out.positions).toHaveLength(1);
    expect(out.skills).toEqual(['s']);
  });
});

describe('applyResumeSectionSelection', () => {
  it('gap-fills positions between min and max selected index', () => {
    const doc: ResumeDocument = {
      contact: { name: 'A', headline: 'H' },
      summary: 's',
      positions: [
        { title: 'A', company: 'Acme', startDate: '2018', endDate: '2019', bullets: ['x'] },
        { title: 'B', company: 'Beta', startDate: '2019', endDate: undefined, bullets: ['y'] },
        { title: 'C', company: 'Corp', startDate: '2020', endDate: undefined, bullets: ['z'] },
      ],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      languages: [],
      volunteer: [],
      awards: [],
      flair: 2,
      template: 'classic',
      jobTitle: 'J',
      company: 'Co',
      generatedAt: new Date().toISOString(),
    };
    const { doc: out, gapReincludedCompanies } = applyResumeSectionSelection(doc, [
      'summary',
      'pos:0',
      'pos:2',
    ]);
    expect(gapReincludedCompanies).toEqual(['Beta']);
    expect(out.positions).toHaveLength(3);
  });

  it('includes at least MIN_VISIBLE_RESUME_POSITIONS roles when user selects only the first', () => {
    const doc: ResumeDocument = {
      contact: { name: 'A', headline: 'H' },
      summary: 's',
      positions: [
        { title: 'New', company: 'N', startDate: '2022', endDate: undefined, bullets: ['a'] },
        { title: 'Mid', company: 'M', startDate: '2019', endDate: '2021', bullets: ['b'] },
        { title: 'Old', company: 'O', startDate: '2015', endDate: '2018', bullets: ['c'] },
        { title: 'Ancient', company: 'Q', startDate: '2010', endDate: '2014', bullets: ['d'] },
      ],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
      languages: [],
      volunteer: [],
      awards: [],
      flair: 2,
      template: 'classic',
      jobTitle: 'J',
      company: 'Co',
      generatedAt: new Date().toISOString(),
    };
    const { doc: out } = applyResumeSectionSelection(doc, ['summary', 'pos:0']);
    expect(out.positions).toHaveLength(MIN_VISIBLE_RESUME_POSITIONS);
    expect(out.positions[0]?.company).toBe('N');
    expect(out.positions[2]?.company).toBe('O');
  });
});
