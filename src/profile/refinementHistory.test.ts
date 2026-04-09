import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreGlobalRefinedSnapshot } from '../services/refinementHistory.ts';
import { fileExists } from '../utils/fs.ts';
import {
  canonicalRefinedDataJson,
  refinedDataIdentityCanon,
  refinedHistoryDir,
} from './refinementHistory.ts';
import type { Profile, RefinementSession } from './schema.ts';
import {
  jobRefinementPath,
  loadRefined,
  saveJob,
  saveJobRefinement,
  saveRefined,
} from './serializer.ts';

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

function session(): RefinementSession {
  return {
    conductedAt: '2020-01-02T00:00:00.000Z',
    sourceHash: 'abc',
    questions: [],
    answers: {},
  };
}

describe('refinement history', () => {
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not snapshot on first refined save', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p = fixtureProfile('A');
    await saveRefined({ profile: p, session: session() }, dir, { reason: 'qa-save' });
    expect(await fileExists(join(refinedHistoryDir(dir), '1.json'))).toBe(false);
  });

  it('snapshots previous state on second substantive save', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p1 = fixtureProfile('A');
    await saveRefined({ profile: p1, session: session() }, dir, { reason: 'qa-save' });
    const p2 = fixtureProfile('B');
    await saveRefined({ profile: p2, session: session() }, dir, { reason: 'profile-editor' });
    const snapPath = join(refinedHistoryDir(dir), '1.json');
    const raw = JSON.parse(await readFile(snapPath, 'utf-8')) as { data: { profile: Profile } };
    expect(raw.data.profile.contact.name.value).toBe('A');
    const cur = await loadRefined(dir);
    expect(cur.profile.contact.name.value).toBe('B');
  });

  it('no snapshot and no write when identity unchanged (ignore updatedAt-only churn)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p = fixtureProfile('A');
    const s = session();
    await saveRefined({ profile: p, session: s }, dir, { reason: 'qa-save' });
    const before = await readFile(join(dir, 'refined.json'), 'utf-8');
    await saveRefined({ profile: p, session: s }, dir, { reason: 'unspecified' });
    const after = await readFile(join(dir, 'refined.json'), 'utf-8');
    expect(after).toBe(before);
    expect(await fileExists(refinedHistoryDir(dir))).toBe(false);
  });

  it('restoreGlobalRefinedSnapshot reapplies snapshot and clears pinnedRender', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p1 = fixtureProfile('One');
    await saveRefined({ profile: p1, session: session() }, dir, { reason: 'qa-save' });
    const p2 = fixtureProfile('Two');
    await saveRefined({ profile: p2, session: session() }, dir, { reason: 'qa-save' });

    await saveJob(
      {
        id: 'job-1',
        company: 'Co',
        title: 'T',
        savedAt: '2020-01-01T00:00:00.000Z',
        text: 'jd',
        textHash: 'x'.repeat(64),
      },
      dir,
    );
    await saveJobRefinement(
      {
        jobId: 'job-1',
        createdAt: '2020-01-01T00:00:00.000Z',
        jobAnalysis: {
          company: 'Co',
          title: 'T',
          industry: 'software-engineering',
          seniority: 'senior',
          keySkills: [],
          mustHaves: [],
          niceToHaves: [],
          summary: '',
        },
        plan: {
          selectedPositions: [],
          selectedSkillIds: [],
          selectedProjectIds: [],
          selectedEducationIds: [],
          selectedCertificationIds: [],
          summaryRef: null,
        },
        pinnedRender: {
          requestedFlair: 2,
          effectiveFlair: 2,
          resolvedTemplate: 'classic',
          squeezeLevel: 1,
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      dir,
    );

    await restoreGlobalRefinedSnapshot(dir, '1');
    const cur = await loadRefined(dir);
    expect(cur.profile.contact.name.value).toBe('One');
    const jr = JSON.parse(await readFile(jobRefinementPath(dir, 'job-1'), 'utf-8')) as {
      pinnedRender?: unknown;
    };
    expect(jr.pinnedRender).toBeUndefined();
  });

  it('skipHistorySnapshot avoids creating refined-history/', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p1 = fixtureProfile('A');
    await saveRefined({ profile: p1, session: session() }, dir);
    const p2 = fixtureProfile('B');
    await saveRefined({ profile: p2, session: session() }, dir, { skipHistorySnapshot: true });
    expect(await fileExists(refinedHistoryDir(dir))).toBe(false);
  });

  it('restore replaceHeadOnly does not add a new snapshot file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    const p1 = fixtureProfile('One');
    await saveRefined({ profile: p1, session: session() }, dir);
    const p2 = fixtureProfile('Two');
    await saveRefined({ profile: p2, session: session() }, dir);
    const hist = refinedHistoryDir(dir);
    const count1 = (await readdir(hist)).filter((f) => /^\d+\.json$/.test(f)).length;
    expect(count1).toBe(1);
    await restoreGlobalRefinedSnapshot(dir, '1', { replaceHeadOnly: true });
    const count2 = (await readdir(hist)).filter((f) => /^\d+\.json$/.test(f)).length;
    expect(count2).toBe(1);
  });

  it('prunes oldest snapshots when over max', async () => {
    dir = await mkdtemp(join(tmpdir(), 'suited-rh-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let p = fixtureProfile('A0');
    for (let i = 0; i < 4; i++) {
      p = { ...p, contact: { ...p.contact, name: u(`A${i}`) } };
      await saveRefined({ profile: p, session: session() }, dir, {
        reason: 'qa-save',
        maxHistorySnapshots: 2,
      });
    }
    const names = (await readdir(refinedHistoryDir(dir))).filter((n) => /^\d+\.json$/.test(n));
    expect(names.length).toBe(2);
  });
});

describe('refinedDataIdentityCanon', () => {
  it('differs when session changes', () => {
    const p = fixtureProfile('X');
    const a: RefinedData = { profile: p, session: session() };
    const b: RefinedData = {
      profile: p,
      session: { ...session(), sourceHash: 'different' },
    };
    expect(refinedDataIdentityCanon(a)).not.toBe(refinedDataIdentityCanon(b));
    expect(canonicalRefinedDataJson(a)).not.toBe(canonicalRefinedDataJson(b));
  });
});
