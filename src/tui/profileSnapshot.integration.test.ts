import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile, RefinementSession } from '../profile/schema.ts';
import { saveJob, saveRefined, saveSource } from '../profile/serializer.ts';
import { getDashboardVariant } from './dashboardVariant.ts';
import { hasApiKey } from './env.ts';
import { fetchProfileSnapshot } from './fetchProfileSnapshot.ts';

const u = (s: string) => ({
  value: s,
  source: { kind: 'user-edit' as const, editedAt: '2020-01-01T00:00:00.000Z' },
});

function fixtureProfile(name: string): Profile {
  const t = '2020-01-01T00:00:00.000Z';
  return {
    schemaVersion: '1',
    createdAt: t,
    updatedAt: t,
    contact: { name: u(name) },
    positions: [
      {
        id: 'pos-0',
        title: u('Engineer'),
        company: u('Acme'),
        startDate: u('2020-01'),
        bullets: [u('Did things')],
      },
    ],
    education: [],
    skills: [{ id: 'sk1', name: u('TypeScript') }],
    certifications: [],
    projects: [],
    publications: [],
    languages: [],
    volunteer: [],
    awards: [],
  };
}

describe('fetchProfileSnapshot + dashboard variants (fixtures)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('empty dir → no source, variant no-source when API key present', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-snap-'));
    const snap = await fetchProfileSnapshot(dir);
    expect(snap.hasSource).toBe(false);
    expect(snap.hasRefined).toBe(false);
    expect(snap.jobsCount).toBe(0);
    expect(getDashboardVariant(snap, true)).toBe('no-source');
  });

  it('source only → source-only', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-snap-'));
    await saveSource(fixtureProfile('Pat'), dir);
    const snap = await fetchProfileSnapshot(dir);
    expect(snap.hasSource).toBe(true);
    expect(snap.hasRefined).toBe(false);
    expect(snap.name).toBe('Pat');
    expect(snap.positionCount).toBe(1);
    expect(snap.skillCount).toBe(1);
    expect(getDashboardVariant(snap, true)).toBe('source-only');
  });

  it('source + refined + no jobs → refined', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-snap-'));
    const p = fixtureProfile('Q');
    await saveSource(p, dir);
    const session: RefinementSession = {
      conductedAt: '2020-01-02T00:00:00.000Z',
      sourceHash: 'abc',
      questions: [],
      answers: {},
    };
    await saveRefined({ profile: p, session }, dir);
    const snap = await fetchProfileSnapshot(dir);
    expect(snap.hasRefined).toBe(true);
    expect(snap.jobsCount).toBe(0);
    expect(getDashboardVariant(snap, true)).toBe('refined');
  });

  it('refined + saved job → ready', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-snap-'));
    const p = fixtureProfile('R');
    await saveSource(p, dir);
    const session: RefinementSession = {
      conductedAt: '2020-01-02T00:00:00.000Z',
      sourceHash: 'abc',
      questions: [],
      answers: {},
    };
    await saveRefined({ profile: p, session }, dir);
    await saveJob(
      {
        id: 'job-1',
        title: 'Role',
        company: 'Co',
        text: 'JD text here',
        textHash: 'deadbeef',
        savedAt: '2020-01-03T00:00:00.000Z',
      },
      dir,
    );
    const snap = await fetchProfileSnapshot(dir);
    expect(snap.jobsCount).toBe(1);
    expect(getDashboardVariant(snap, true)).toBe('ready');
  });

  it('no-api-key variant ignores file state', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-snap-'));
    await saveSource(fixtureProfile('S'), dir);
    const snap = await fetchProfileSnapshot(dir);
    expect(getDashboardVariant(snap, false)).toBe('no-api-key');
  });
});

describe('hasApiKey (sanity for dashboard)', () => {
  it('is boolean', () => {
    expect(typeof hasApiKey()).toBe('boolean');
  });
});
