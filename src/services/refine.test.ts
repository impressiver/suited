import { describe, expect, it } from 'vitest';
import type { Profile } from '../profile/schema.js';
import { computeRefinementDiff } from './refine.js';

const src = (s: string) => ({
  value: s,
  source: { kind: 'user-edit' as const, editedAt: '2020-01-01' },
});

function minimalProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    contact: {
      name: src('N'),
    },
    positions: [
      {
        id: 'pos-0',
        title: src('T'),
        company: src('C'),
        startDate: src('2020'),
        bullets: [src('old')],
      },
    ],
    skills: [{ id: 'sk1', name: src('Go') }],
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

describe('computeRefinementDiff', () => {
  it('returns empty when profiles match on compared fields', () => {
    const p = minimalProfile();
    expect(computeRefinementDiff(p, structuredClone(p))).toEqual([]);
  });

  it('detects bullet changes', () => {
    const a = minimalProfile();
    const b = structuredClone(a);
    b.positions[0].bullets = [src('new')];
    const d = computeRefinementDiff(a, b);
    expect(d.some((x) => x.kind === 'position-bullets')).toBe(true);
  });
});
