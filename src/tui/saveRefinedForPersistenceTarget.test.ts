import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../profile/schema.ts';
import { globalRefinedTarget, jobRefinedTarget } from './activeDocumentSession.ts';

const serializerMocks = vi.hoisted(() => ({
  saveRefined: vi.fn().mockResolvedValue(undefined),
  saveJobRefinedProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../profile/serializer.ts', () => ({
  saveRefined: serializerMocks.saveRefined,
  saveJobRefinedProfile: serializerMocks.saveJobRefinedProfile,
}));

const { saveRefinedForPersistenceTarget } = await import('./saveRefinedForPersistenceTarget.ts');

describe('saveRefinedForPersistenceTarget', () => {
  const profileDir = '/tmp/suited-test-profile';
  const profile = { id: 'p1' } as unknown as Profile;
  const session = {
    conductedAt: '2026-01-01T00:00:00.000Z',
    sourceHash: 'abc',
    questions: [],
    answers: {},
  };

  beforeEach(() => {
    serializerMocks.saveRefined.mockClear();
    serializerMocks.saveJobRefinedProfile.mockClear();
  });

  it('calls saveRefined and not saveJobRefinedProfile when target is global-refined', async () => {
    await saveRefinedForPersistenceTarget(
      globalRefinedTarget(),
      { profile, session, profileDir },
      { reason: 'profile-editor' },
    );
    expect(serializerMocks.saveRefined).toHaveBeenCalledTimes(1);
    expect(serializerMocks.saveRefined).toHaveBeenCalledWith({ profile, session }, profileDir, {
      reason: 'profile-editor',
    });
    expect(serializerMocks.saveJobRefinedProfile).not.toHaveBeenCalled();
  });

  it('calls saveJobRefinedProfile and not saveRefined when target is job', async () => {
    const slug = 'acme-staff';
    await saveRefinedForPersistenceTarget(jobRefinedTarget('jid-1', slug), {
      profile,
      session,
      profileDir,
    });
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledTimes(1);
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledWith(profile, profileDir, slug);
    expect(serializerMocks.saveRefined).not.toHaveBeenCalled();
  });

  it('never invokes saveRefined for job target even when SaveRefinedOptions are passed', async () => {
    const slug = 'other-co-role';
    await saveRefinedForPersistenceTarget(
      jobRefinedTarget('jid-2', slug),
      { profile, session, profileDir },
      { reason: 'profile-editor' },
    );
    expect(serializerMocks.saveRefined).not.toHaveBeenCalled();
    expect(serializerMocks.saveJobRefinedProfile).toHaveBeenCalledTimes(1);
  });
});
