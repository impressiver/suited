import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getGlobalContactMetaPath,
  getGlobalLogoCachePath,
  getLegacyLinkedInSessionPath,
  getLegacySuitedDir,
  getLinkedInSessionPath,
  getSuitedCacheDir,
  getSuitedConfigDir,
} from './suitedDirs.ts';

describe('suitedDirs', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('honors XDG_CONFIG_HOME on non-Windows', () => {
    if (process.platform === 'win32') return;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-config-test';
    expect(getSuitedConfigDir()).toBe('/tmp/xdg-config-test/suited');
    expect(getLinkedInSessionPath()).toBe('/tmp/xdg-config-test/suited/linkedin-session.json');
  });

  it('honors XDG_CACHE_HOME on non-Windows', () => {
    if (process.platform === 'win32') return;
    process.env.XDG_CACHE_HOME = '/tmp/xdg-cache-test';
    expect(getSuitedCacheDir()).toBe('/tmp/xdg-cache-test/suited');
    expect(getGlobalLogoCachePath()).toBe('/tmp/xdg-cache-test/suited/logo-cache.json');
  });

  it('global contact path under XDG_CONFIG_HOME on non-Windows', () => {
    if (process.platform === 'win32') return;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-cfg-meta';
    expect(getGlobalContactMetaPath()).toBe('/tmp/xdg-cfg-meta/suited/contact.json');
  });

  it('defaults config under ~/.config on non-Windows when XDG unset', () => {
    if (process.platform === 'win32') return;
    delete process.env.XDG_CONFIG_HOME;
    expect(getSuitedConfigDir()).toBe(join(homedir(), '.config', 'suited'));
  });

  it('defaults cache under ~/.cache on non-Windows when XDG unset', () => {
    if (process.platform === 'win32') return;
    delete process.env.XDG_CACHE_HOME;
    expect(getSuitedCacheDir()).toBe(join(homedir(), '.cache', 'suited'));
  });

  it('legacy paths stay under ~/.suited', () => {
    expect(getLegacySuitedDir()).toBe(join(homedir(), '.suited'));
    expect(getLegacyLinkedInSessionPath()).toBe(
      join(homedir(), '.suited', 'linkedin-session.json'),
    );
  });
});
