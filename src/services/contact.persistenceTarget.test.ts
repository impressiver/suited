import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import { jobRefinedTarget } from '../tui/activeDocumentSession.ts';

function minimalProfile(): Profile {
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
      name: user('Pat Example'),
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

const serializerMocks = vi.hoisted(() => ({
  loadActiveProfile: vi.fn(),
  loadContactMeta: vi.fn(),
  loadJobRefinedProfile: vi.fn(),
  loadRefined: vi.fn(),
  refinedJsonPath: vi.fn((d: string) => `${d}/refined.json`),
  saveContactMeta: vi.fn().mockResolvedValue(undefined),
  saveJobRefinedProfile: vi.fn().mockResolvedValue(undefined),
  saveRefined: vi.fn().mockResolvedValue(undefined),
  saveSource: vi.fn().mockResolvedValue(undefined),
  sourceMdPath: vi.fn((d: string) => `${d}/source.md`),
}));

vi.mock('../profile/markdown.ts', () => ({
  profileToMarkdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../profile/serializer.ts', () => serializerMocks);

const { mergeContactMeta } = await import('./contact.ts');

describe('mergeContactMeta persistenceTarget', () => {
  const profileDir = '/tmp/suited-merge-contact';
  const slug = 'acme-staff';

  beforeEach(() => {
    vi.clearAllMocks();
    serializerMocks.loadContactMeta.mockResolvedValue({});
    serializerMocks.loadRefined.mockResolvedValue({
      profile: minimalProfile(),
      session: {
        conductedAt: '2026-01-01T00:00:00.000Z',
        sourceHash: 'abc',
        questions: [],
        answers: {},
      },
    });
  });

  it('calls saveJobRefinedProfile and not saveRefined when target is job and job refined exists', async () => {
    const base = minimalProfile();
    serializerMocks.loadJobRefinedProfile.mockResolvedValue(base);
    await mergeContactMeta({ email: 'job@example.com' }, profileDir, {
      persistenceTarget: jobRefinedTarget('jid-1', slug),
    });
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledTimes(1);
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: expect.objectContaining({
          email: expect.objectContaining({ value: 'job@example.com' }),
        }),
      }),
      profileDir,
      slug,
    );
    expect(serializerMocks.saveRefined).not.toHaveBeenCalled();
    expect(serializerMocks.saveSource).not.toHaveBeenCalled();
    expect(serializerMocks.loadActiveProfile).not.toHaveBeenCalled();
  });

  it('calls saveJobRefinedProfile and not saveRefined when target is job and falls back to loadActiveProfile', async () => {
    const base = minimalProfile();
    serializerMocks.loadJobRefinedProfile.mockResolvedValue(null);
    serializerMocks.loadActiveProfile.mockResolvedValue(base);
    await mergeContactMeta({ email: 'fallback@example.com' }, profileDir, {
      persistenceTarget: jobRefinedTarget('jid-1', slug),
    });
    expect(serializerMocks.loadActiveProfile).toHaveBeenCalledWith(profileDir);
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledTimes(1);
    expect(serializerMocks.saveRefined).not.toHaveBeenCalled();
    expect(serializerMocks.saveSource).not.toHaveBeenCalled();
  });
});
