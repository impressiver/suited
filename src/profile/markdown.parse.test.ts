import { describe, expect, it } from 'vitest';
import {
  parseDisplayMarkdownStringToProfile,
  parseMarkdownStringToProfile,
  profileMarkdownContent,
  stripHtmlCommentsFromProfileMarkdown,
} from './markdown.ts';
import type { DataSource, Profile } from './schema.ts';

const ue = (editedAt: string): DataSource => ({ kind: 'user-edit', editedAt });

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

describe('stripHtmlCommentsFromProfileMarkdown + parseDisplayMarkdownStringToProfile', () => {
  it('hides comments and preserves position id on round-trip', () => {
    const p = minimalProfile({
      positions: [
        {
          id: 'pos-0',
          title: { value: 'Engineer', source: ue('2020-01-01T00:00:00.000Z') },
          company: { value: 'Acme Corp', source: ue('2020-01-01T00:00:00.000Z') },
          startDate: { value: '2020-01', source: ue('2020-01-01T00:00:00.000Z') },
          bullets: [{ value: 'Shipped things', source: ue('2020-01-01T00:00:00.000Z') }],
        },
      ],
    });
    const full = profileMarkdownContent(p);
    expect(full).toContain('<!-- pos-id:pos-0 -->');
    const stripped = stripHtmlCommentsFromProfileMarkdown(full);
    expect(stripped).not.toMatch(/<!--/);
    const p2 = parseDisplayMarkdownStringToProfile(stripped, p);
    expect(p2.positions).toHaveLength(1);
    expect(p2.positions[0]?.id).toBe('pos-0');
    expect(p2.positions[0]?.title.value).toBe('Engineer');
    expect(p2.positions[0]?.company.value).toBe('Acme Corp');
    expect(p2.positions[0]?.bullets[0]?.value).toBe('Shipped things');
    const again = profileMarkdownContent(p2);
    expect(again).toContain('<!-- pos-id:pos-0 -->');
    expect(again).toContain('<!-- src:');
  });

  it('omits comment-only physical lines (metadata rows) from the editor buffer', () => {
    const md = '## Experience\n\n<!-- pos-id:x -->\n### Role at Co\n\nBody';
    const stripped = stripHtmlCommentsFromProfileMarkdown(md);
    expect(stripped).not.toMatch(/<!--/);
    expect(md.split('\n').length - stripped.split('\n').length).toBe(1);
    expect(stripped).toContain('## Experience');
    expect(stripped).toContain('### Role at Co');
    expect(stripped).toContain('Body');
  });

  it('normalizes CRLF and stray CR to LF before stripping', () => {
    const md = 'a\r\nb\rc\r\n<!-- x -->\r\n';
    const stripped = stripHtmlCommentsFromProfileMarkdown(md);
    expect(stripped).toBe('a\nb\nc\n');
    expect(stripped).not.toContain('\r');
  });
});
