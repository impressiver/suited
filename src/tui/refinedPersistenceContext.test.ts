import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import { globalRefinedTarget, jobRefinedTarget } from './activeDocumentSession.ts';

const profileDir = '/tmp/suited-refine-load-test';
const slug = 'acme-engineer';

const mockProfile = (tag: string): Profile =>
  ({
    schemaVersion: '1',
    tag,
    createdAt: 'a',
    updatedAt: 'b',
    contact: { name: { value: 'n', source: { kind: 'user-edit', editedAt: 't' } } },
    positions: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    publications: [],
    languages: [],
    volunteer: [],
    awards: [],
  }) as unknown as Profile;

const serializerMocks = vi.hoisted(() => ({
  loadRefinedIfExists: vi.fn(),
  loadJobRefinedProfile: vi.fn(),
  loadActiveProfile: vi.fn(),
  hashSource: vi.fn().mockResolvedValue('hash-src'),
}));

vi.mock('../profile/serializer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../profile/serializer.ts')>();
  return {
    ...actual,
    loadRefinedIfExists: serializerMocks.loadRefinedIfExists,
    loadJobRefinedProfile: serializerMocks.loadJobRefinedProfile,
    loadActiveProfile: serializerMocks.loadActiveProfile,
    hashSource: serializerMocks.hashSource,
  };
});

const { loadRefinedTuiState } = await import('./refinedPersistenceContext.ts');

describe('loadRefinedTuiState', () => {
  beforeEach(() => {
    serializerMocks.loadRefinedIfExists.mockReset();
    serializerMocks.loadJobRefinedProfile.mockReset();
    serializerMocks.loadActiveProfile.mockReset();
    serializerMocks.hashSource.mockClear();
  });

  it('global target: uses loadRefinedIfExists profile and session when present', async () => {
    const profile = mockProfile('global-body');
    const session = {
      conductedAt: '2020-01-01T00:00:00.000Z',
      sourceHash: 'x',
      questions: [],
      answers: {},
    };
    serializerMocks.loadRefinedIfExists.mockResolvedValue({ profile, session });
    const got = await loadRefinedTuiState(profileDir, globalRefinedTarget());
    expect(got.profile).toBe(profile);
    expect(got.session).toBe(session);
    expect(serializerMocks.loadJobRefinedProfile).not.toHaveBeenCalled();
    expect(serializerMocks.loadActiveProfile).not.toHaveBeenCalled();
    expect(serializerMocks.hashSource).not.toHaveBeenCalled();
  });

  it('global target: no refined.json falls back to loadActiveProfile and synthetic session', async () => {
    const profile = mockProfile('active');
    serializerMocks.loadRefinedIfExists.mockResolvedValue(null);
    serializerMocks.loadActiveProfile.mockResolvedValue(profile);
    const got = await loadRefinedTuiState(profileDir, globalRefinedTarget());
    expect(got.profile).toBe(profile);
    expect(got.session.sourceHash).toBe('hash-src');
    expect(got.session.questions).toEqual([]);
    expect(serializerMocks.loadActiveProfile).toHaveBeenCalledWith(profileDir);
    expect(serializerMocks.hashSource).toHaveBeenCalledWith(profileDir);
    expect(serializerMocks.loadJobRefinedProfile).not.toHaveBeenCalled();
  });

  it('job target: job refined wins over global and loadActiveProfile', async () => {
    const jobP = mockProfile('job-body');
    const globalP = mockProfile('global-body');
    const session = {
      conductedAt: '2020-01-01T00:00:00.000Z',
      sourceHash: 'g',
      questions: [],
      answers: {},
    };
    serializerMocks.loadRefinedIfExists.mockResolvedValue({ profile: globalP, session });
    serializerMocks.loadJobRefinedProfile.mockResolvedValue(jobP);
    const got = await loadRefinedTuiState(profileDir, jobRefinedTarget('jid', slug));
    expect(got.profile).toBe(jobP);
    expect(got.session).toBe(session);
    expect(serializerMocks.loadJobRefinedProfile).toHaveBeenCalledWith(profileDir, slug);
    expect(serializerMocks.loadActiveProfile).not.toHaveBeenCalled();
    const globalOrder = serializerMocks.loadRefinedIfExists.mock.invocationCallOrder[0];
    const jobOrder = serializerMocks.loadJobRefinedProfile.mock.invocationCallOrder[0];
    expect(globalOrder).toBeDefined();
    expect(jobOrder).toBeDefined();
    expect(globalOrder as number).toBeLessThan(jobOrder as number);
  });

  it('job target: no job file uses loadActiveProfile; session still from global refined', async () => {
    const globalP = mockProfile('global-body');
    const session = {
      conductedAt: '2020-01-01T00:00:00.000Z',
      sourceHash: 'g',
      questions: [],
      answers: {},
    };
    serializerMocks.loadRefinedIfExists.mockResolvedValue({ profile: globalP, session });
    serializerMocks.loadJobRefinedProfile.mockResolvedValue(null);
    serializerMocks.loadActiveProfile.mockResolvedValue(globalP);
    const got = await loadRefinedTuiState(profileDir, jobRefinedTarget('jid', slug));
    expect(got.profile).toBe(globalP);
    expect(got.session).toBe(session);
    expect(serializerMocks.loadJobRefinedProfile).toHaveBeenCalledBefore(
      serializerMocks.loadActiveProfile as unknown as typeof serializerMocks.loadJobRefinedProfile,
    );
  });

  it('job target: no job file and no global refined uses loadActiveProfile and synthetic session', async () => {
    const sourceP = mockProfile('source-only');
    serializerMocks.loadRefinedIfExists.mockResolvedValue(null);
    serializerMocks.loadJobRefinedProfile.mockResolvedValue(null);
    serializerMocks.loadActiveProfile.mockResolvedValue(sourceP);
    const got = await loadRefinedTuiState(profileDir, jobRefinedTarget('jid', slug));
    expect(got.profile).toBe(sourceP);
    expect(got.session.sourceHash).toBe('hash-src');
    expect(serializerMocks.hashSource).toHaveBeenCalledWith(profileDir);
  });
});
