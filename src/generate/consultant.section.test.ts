import { describe, expect, it } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import {
  buildExperiencePositionConsultantLabel,
  buildSectionScopedProfileEvaluationUserMessage,
} from './consultant.ts';

const minimalProfile = {
  schemaVersion: 1,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  contact: {
    name: { value: 'N', source: { kind: 'imported' } },
    headline: { value: 'H', source: { kind: 'imported' } },
    email: { value: 'e@e', source: { kind: 'imported' } },
    phone: { value: '', source: { kind: 'imported' } },
    location: { value: '', source: { kind: 'imported' } },
    linkedin: { value: '', source: { kind: 'imported' } },
    website: { value: '', source: { kind: 'imported' } },
    github: { value: '', source: { kind: 'imported' } },
  },
  summary: { value: 'Summary line', source: { kind: 'imported' } },
  positions: [],
  skills: [],
  education: [],
  certifications: [],
  projects: [],
  languages: [],
  volunteer: [],
  awards: [],
} as unknown as Profile;

describe('buildExperiencePositionConsultantLabel', () => {
  it('names title, company, and id when position exists', () => {
    const p = {
      ...minimalProfile,
      positions: [
        {
          id: 'pos-a',
          title: { value: 'Engineer', source: { kind: 'imported' } },
          company: { value: 'Acme', source: { kind: 'imported' } },
          startDate: { value: '2020-01', source: { kind: 'imported' } },
          bullets: [],
        },
      ],
    } as unknown as Profile;
    const lab = buildExperiencePositionConsultantLabel(p, 'pos-a');
    expect(lab).toContain('Engineer');
    expect(lab).toContain('Acme');
    expect(lab).toContain('pos-a');
  });

  it('falls back when id is unknown', () => {
    const lab = buildExperiencePositionConsultantLabel(minimalProfile, 'ghost');
    expect(lab).toContain('ghost');
    expect(lab).toContain('Experience');
  });
});

describe('buildSectionScopedProfileEvaluationUserMessage', () => {
  it('includes section label and profile body', () => {
    const msg = buildSectionScopedProfileEvaluationUserMessage('Summary', minimalProfile);
    expect(msg).toContain('ONLY the resume section');
    expect(msg).toContain('Summary');
    expect(msg).toContain('Summary line');
  });
});
