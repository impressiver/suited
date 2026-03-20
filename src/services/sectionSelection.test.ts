import { describe, expect, it } from 'vitest';
import type { ResumeDocument } from '../profile/schema.ts';
import { selectAllSections } from './sectionSelection.ts';

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
