import { describe, expect, it } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import { missingContactDetailPromptLabels } from './contact.ts';

function minimalProfile(overrides: Partial<Profile['contact']> = {}): Profile {
  const now = new Date().toISOString();
  const user = (v: string) => ({
    value: v,
    source: { kind: 'user-edit' as const, editedAt: now },
  });
  return {
    schemaVersion: '1',
    createdAt: now,
    updatedAt: now,
    contact: {
      name: user('A'),
      ...overrides,
    },
    positions: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    publications: [],
    languages: [],
    volunteer: [],
    awards: [],
  };
}

describe('missingContactDetailPromptLabels', () => {
  it('lists all four when empty', () => {
    expect(missingContactDetailPromptLabels(minimalProfile())).toEqual([
      'job title',
      'email',
      'phone',
      'LinkedIn URL',
    ]);
  });

  it('omits filled headline/email/phone/linkedin', () => {
    const p = minimalProfile({
      headline: { value: 'Eng', source: { kind: 'user-edit', editedAt: 'x' } },
      email: { value: 'a@b.co', source: { kind: 'user-edit', editedAt: 'x' } },
      phone: { value: '1', source: { kind: 'user-edit', editedAt: 'x' } },
      linkedin: { value: 'https://li', source: { kind: 'user-edit', editedAt: 'x' } },
    });
    expect(missingContactDetailPromptLabels(p)).toEqual([]);
  });
});
