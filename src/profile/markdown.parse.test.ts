import { describe, expect, it } from 'vitest';
import { parseMarkdownStringToProfile, profileMarkdownContent } from './markdown.ts';
import type { Profile } from './schema.ts';

function minimalProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    schemaVersion: '1',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    contact: {
      name: { value: 'A', source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' } },
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
  return { ...base, ...overrides };
}

describe('parseMarkdownStringToProfile', () => {
  it('round-trips summary through markdown', () => {
    const p = minimalProfile({
      summary: {
        value: 'Hello world',
        source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
      },
    });
    const md = profileMarkdownContent(p);
    const p2 = parseMarkdownStringToProfile(md, p);
    expect(p2.summary?.value).toBe('Hello world');
  });
});
