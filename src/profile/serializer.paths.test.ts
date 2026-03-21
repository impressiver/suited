import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileExists } from '../utils/fs.ts';
import { loadContactMeta, loadLogoCache, saveContactMeta, saveLogoCache } from './serializer.ts';

describe('serializer global contact + logo (XDG)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('loadContactMeta falls back to legacy profile contact.json when global empty', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = configRoot;

    await writeFile(
      join(profileDir, 'contact.json'),
      JSON.stringify({ email: 'legacy@example.com' }),
      'utf-8',
    );
    const meta = await loadContactMeta(profileDir);
    expect(meta.email).toBe('legacy@example.com');
  });

  it('saveContactMeta writes global config and removes legacy contact.json', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = configRoot;

    await writeFile(
      join(profileDir, 'contact.json'),
      JSON.stringify({ email: 'old@example.com' }),
      'utf-8',
    );
    await saveContactMeta({ email: 'new@example.com', phone: '+15550000' }, profileDir);

    const globalPath = join(configRoot, 'suited', 'contact.json');
    expect(await fileExists(globalPath)).toBe(true);
    const stored = JSON.parse(await readFile(globalPath, 'utf-8')) as { email: string };
    expect(stored.email).toBe('new@example.com');
    expect(await fileExists(join(profileDir, 'contact.json'))).toBe(false);
  });

  it('loadLogoCache merges legacy into global and removes legacy file', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const cacheRoot = await mkdtemp(join(tmpdir(), 'suited-cache-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = cacheRoot;

    await writeFile(
      join(profileDir, 'logo-cache.json'),
      JSON.stringify({ Acme: 'data:image/svg+xml,legacy' }),
      'utf-8',
    );
    const cache = await loadLogoCache(profileDir);
    expect(cache.Acme).toBe('data:image/svg+xml,legacy');

    const globalPath = join(cacheRoot, 'suited', 'logo-cache.json');
    expect(await fileExists(globalPath)).toBe(true);
    expect(await fileExists(join(profileDir, 'logo-cache.json'))).toBe(false);
  });

  it('saveLogoCache writes global cache and removes legacy logo-cache.json', async () => {
    if (process.platform === 'win32') return;
    const configRoot = await mkdtemp(join(tmpdir(), 'suited-cfg-'));
    const cacheRoot = await mkdtemp(join(tmpdir(), 'suited-cache-'));
    const profileDir = await mkdtemp(join(tmpdir(), 'suited-prof-'));
    process.env.XDG_CONFIG_HOME = configRoot;
    process.env.XDG_CACHE_HOME = cacheRoot;

    await writeFile(join(profileDir, 'logo-cache.json'), JSON.stringify({ OldCo: 'x' }), 'utf-8');
    await saveLogoCache({ NewCo: 'y' }, profileDir);

    const globalPath = join(cacheRoot, 'suited', 'logo-cache.json');
    expect(JSON.parse(await readFile(globalPath, 'utf-8'))).toEqual({ NewCo: 'y' });
    expect(await fileExists(join(profileDir, 'logo-cache.json'))).toBe(false);
  });
});
