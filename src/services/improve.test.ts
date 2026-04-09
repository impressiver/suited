import { describe, expect, it } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import { computeHealthScore } from './improve.ts';

function minimalProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    contact: {
      name: { value: 'Jane', source: { kind: 'user-edit', editedAt: '2020-01-01' } },
      email: { value: 'a@b.com', source: { kind: 'user-edit', editedAt: '2020-01-01' } },
      phone: { value: '1', source: { kind: 'user-edit', editedAt: '2020-01-01' } },
      linkedin: { value: 'https://in', source: { kind: 'user-edit', editedAt: '2020-01-01' } },
    },
    positions: [],
    skills: Array.from({ length: 10 }, (_, i) => ({
      id: `s-${i}`,
      name: { value: `Skill ${i}`, source: { kind: 'user-edit', editedAt: '2020-01-01' } },
    })),
    education: [],
    projects: [],
    certifications: [],
    languages: [],
    volunteer: [],
    awards: [],
    publications: [],
    patents: [],
    courses: [],
  };
  return { ...base, ...overrides, contact: { ...base.contact, ...overrides.contact } };
}

describe('computeHealthScore', () => {
  it('scores 5 when all checks pass', () => {
    const p = minimalProfile({
      summary: { value: 'x', source: { kind: 'user-edit', editedAt: '2020-01-01' } },
    });
    const h = computeHealthScore(p, true);
    expect(h.score).toBe(5);
    expect(h.contactOk).toBe(true);
    expect(h.skillsOk).toBe(true);
    expect(h.positionsOk).toBe(true);
  });

  it('flags missing skills', () => {
    const p = minimalProfile({ skills: [] });
    const h = computeHealthScore(p, false);
    expect(h.skillsOk).toBe(false);
    expect(h.score).toBeLessThan(5);
  });
});
