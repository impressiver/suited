import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeContactMeta } from './contact.ts';

function minimalProfile() {
  const now = new Date().toISOString();
  const user = (v: string) => ({
    value: v,
    source: { kind: 'user-edit' as const, editedAt: now },
  });
  return {
    schemaVersion: '1' as const,
    createdAt: now,
    updatedAt: now,
    contact: {
      name: user('Pat Example'),
    },
    positions: [] as [],
    education: [] as [],
    skills: [] as [],
    certifications: [] as [],
    projects: [] as [],
    publications: [] as [],
    languages: [] as [],
    volunteer: [] as [],
    awards: [] as [],
  };
}

describe('mergeContactMeta', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('merges global contact.json without dropping keys omitted from the fields payload', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = configRoot;

    const suitedDir = join(configRoot, 'suited');
    await mkdir(suitedDir, { recursive: true });
    await writeFile(
      join(suitedDir, 'contact.json'),
      JSON.stringify({ email: 'keep@example.com', phone: '+1999' }),
      'utf-8',
    );

    await writeFile(join(profileDir, 'source.json'), JSON.stringify(minimalProfile()), 'utf-8');

    await mergeContactMeta({ location: 'Portland' }, profileDir);

    const stored = JSON.parse(await readFile(join(suitedDir, 'contact.json'), 'utf-8')) as Record<
      string,
      string
    >;
    expect(stored.email).toBe('keep@example.com');
    expect(stored.phone).toBe('+1999');
    expect(stored.location).toBe('Portland');
  });

  it('clears a global key when fields includes that key as empty string', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = configRoot;

    const suitedDir = join(configRoot, 'suited');
    await mkdir(suitedDir, { recursive: true });
    await writeFile(
      join(suitedDir, 'contact.json'),
      JSON.stringify({ email: 'gone@example.com' }),
      'utf-8',
    );

    const p = minimalProfile();
    await writeFile(join(profileDir, 'source.json'), JSON.stringify(p), 'utf-8');

    await mergeContactMeta({ email: '' }, profileDir);

    const stored = JSON.parse(await readFile(join(suitedDir, 'contact.json'), 'utf-8')) as Record<
      string,
      string
    >;
    expect(stored.email).toBeUndefined();
  });
});
