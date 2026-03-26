import { describe, expect, it } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import {
  buildResumeSectionIndex,
  buildSectionScrollRowMap,
  experiencePositionShortLabel,
  findDisplayRowForSection,
  matchSectionEntryForHeadingLine,
  resumeExperiencePositionIdAtMarkdownOffset,
  resumeExperiencePositionIdForEditorView,
  resumeSectionIdAtMarkdownOffset,
} from './resumeSectionIndex.ts';

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

describe('buildResumeSectionIndex', () => {
  it('returns ids in document order for populated sections', () => {
    const p = minimalProfile({
      summary: {
        value: 'Hi',
        source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
      },
      positions: [
        {
          id: 'pos-0',
          title: {
            value: 'T',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          company: {
            value: 'C',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          startDate: {
            value: '2020-01',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          bullets: [],
        },
      ],
      skills: [
        {
          id: 'sk-0',
          name: {
            value: 'Go',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
        },
      ],
      education: [
        {
          id: 'ed-0',
          institution: {
            value: 'U',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
        },
      ],
    });
    const idx = buildResumeSectionIndex(p);
    expect(idx.map((e) => e.id)).toEqual(['summary', 'experience', 'skills', 'education']);
    expect(idx.map((e) => e.polishLabel)).toEqual(['Summary', 'Experience', 'Skills', 'Education']);
  });

  it('omits sections with no markdown block', () => {
    const p = minimalProfile();
    expect(buildResumeSectionIndex(p)).toEqual([]);
  });
});

describe('findDisplayRowForSection', () => {
  it('finds ## heading line index with tolerant case', () => {
    const lines = ['# Doc', '', '##  summary  ', 'body', '## Experience', 'x'];
    const entries = buildResumeSectionIndex(
      minimalProfile({
        summary: {
          value: 's',
          source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
        },
        positions: [
          {
            id: 'p',
            title: {
              value: 't',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            company: {
              value: 'c',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            startDate: {
              value: '2020-01',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            bullets: [],
          },
        ],
      }),
    );
    const sum = entries.find((e) => e.id === 'summary');
    const exp = entries.find((e) => e.id === 'experience');
    expect(sum).toBeDefined();
    expect(exp).toBeDefined();
    if (sum == null || exp == null) {
      return;
    }
    expect(findDisplayRowForSection(lines, sum)).toBe(2);
    expect(findDisplayRowForSection(lines, exp)).toBe(4);
  });

  it('does not match ### subheadings', () => {
    const lines = ['### Summary', '## Summary'];
    const idx = buildResumeSectionIndex(
      minimalProfile({
        summary: {
          value: 'x',
          source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
        },
      }),
    );
    const entry = idx[0];
    expect(entry).toBeDefined();
    if (entry == null) {
      return;
    }
    expect(findDisplayRowForSection(lines, entry)).toBe(1);
  });
});

describe('resumeSectionIdAtMarkdownOffset', () => {
  it('returns section for caret after a ## heading until the next', () => {
    const md = '## Summary\nhello\n## Skills\ntail';
    const entries = buildResumeSectionIndex(
      minimalProfile({
        summary: {
          value: 's',
          source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
        },
        skills: [
          {
            id: 'sk',
            name: {
              value: 'Go',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
          },
        ],
      }),
    );
    const inSummary = md.indexOf('hello');
    expect(resumeSectionIdAtMarkdownOffset(md, inSummary, entries)).toBe('summary');
    expect(resumeSectionIdAtMarkdownOffset(md, md.indexOf('tail'), entries)).toBe('skills');
    expect(resumeSectionIdAtMarkdownOffset(`\n${md}`, 0, entries)).toBeNull();
  });
});

describe('resumeExperiencePositionIdAtMarkdownOffset', () => {
  it('returns the nearest preceding pos-id comment in Experience', () => {
    const md =
      '## Summary\n\nx\n\n## Experience\n\n<!-- pos-id:p1 -->\n### T1 at C1\n\n**Bullets:**\n\n- a\n\n<!-- pos-id:p2 -->\n### T2 at C2\n\nBody';
    const entries = buildResumeSectionIndex(
      minimalProfile({
        summary: {
          value: 's',
          source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
        },
        positions: [
          {
            id: 'p1',
            title: {
              value: 'T1',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            company: {
              value: 'C1',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            startDate: {
              value: '2020-01',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            bullets: [],
          },
          {
            id: 'p2',
            title: {
              value: 'T2',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            company: {
              value: 'C2',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            startDate: {
              value: '2021-01',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
            bullets: [],
          },
        ],
      }),
    );
    expect(resumeExperiencePositionIdAtMarkdownOffset(md, md.indexOf('Body'), entries)).toBe('p2');
    expect(resumeExperiencePositionIdAtMarkdownOffset(md, md.indexOf('- a'), entries)).toBe('p1');
    expect(resumeExperiencePositionIdAtMarkdownOffset(md, md.indexOf('x'), entries)).toBeNull();
  });

  it('resolves position from ### headings when HTML comments are omitted (editor view)', () => {
    const profile = minimalProfile({
      summary: {
        value: 's',
        source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
      },
      positions: [
        {
          id: 'p1',
          title: {
            value: 'T1',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          company: {
            value: 'C1',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          startDate: {
            value: '2020-01',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          bullets: [],
        },
        {
          id: 'p2',
          title: {
            value: 'T2',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          company: {
            value: 'C2',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          startDate: {
            value: '2021-01',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          bullets: [],
        },
      ],
    });
    const entries = buildResumeSectionIndex(profile);
    const md =
      '## Summary\n\nx\n\n## Experience\n\n### T1 at C1\n\n**Bullets:**\n\n- a\n\n### T2 at C2\n\nBody';
    expect(resumeExperiencePositionIdForEditorView(md, md.indexOf('Body'), profile, entries)).toBe(
      'p2',
    );
    expect(resumeExperiencePositionIdForEditorView(md, md.indexOf('- a'), profile, entries)).toBe(
      'p1',
    );
  });

  it('formats short label from profile', () => {
    const p = minimalProfile({
      positions: [
        {
          id: 'z',
          title: {
            value: 'Dev',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          company: {
            value: 'Co',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          startDate: {
            value: '2020-01',
            source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
          },
          bullets: [],
        },
      ],
    });
    expect(experiencePositionShortLabel(p, 'z')).toBe('Dev @ Co');
    expect(experiencePositionShortLabel(p, 'missing')).toBeNull();
  });
});

describe('matchSectionEntryForHeadingLine', () => {
  it('resolves ## line to entry', () => {
    const entries = buildResumeSectionIndex(
      minimalProfile({
        skills: [
          {
            id: 's',
            name: {
              value: 'x',
              source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
            },
          },
        ],
      }),
    );
    expect(matchSectionEntryForHeadingLine('## Skills', entries)?.id).toBe('skills');
    expect(matchSectionEntryForHeadingLine('  ##  skills  ', entries)?.id).toBe('skills');
    expect(matchSectionEntryForHeadingLine('### Skills', entries)).toBeNull();
  });
});

describe('buildSectionScrollRowMap', () => {
  it('maps section ids to non-decreasing wrapped offsets', () => {
    const p = minimalProfile({
      summary: {
        value: 'Hello world this is a long line that will wrap in a narrow viewport',
        source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' },
      },
      skills: [
        {
          id: 's',
          name: { value: 'x', source: { kind: 'user-edit', editedAt: '2020-01-01T00:00:00.000Z' } },
        },
      ],
    });
    const narrow = 12;
    const map = buildSectionScrollRowMap(p, narrow);
    expect(map.has('summary')).toBe(true);
    expect(map.has('skills')).toBe(true);
    const sOff = map.get('summary');
    const kOff = map.get('skills');
    expect(sOff).toBeDefined();
    expect(kOff).toBeDefined();
    if (sOff === undefined || kOff === undefined) {
      return;
    }
    expect(kOff).toBeGreaterThanOrEqual(sOff);
  });
});
