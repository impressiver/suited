/**
 * XDG-style paths for global suited state (distinct from `--profile-dir` / `output/`).
 * Environment variables are read on each call so tests and shells can override.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Pre-XDG layout; still read for migration. */
export function getLegacySuitedDir(): string {
  return join(homedir(), '.suited');
}

/** $XDG_CONFIG_HOME/suited or ~/.config/suited (macOS/Linux); %APPDATA%/suited on Windows. */
export function getSuitedConfigDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(base, 'suited');
  }
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'suited');
}

/** $XDG_CACHE_HOME/suited or ~/.cache/suited; %LOCALAPPDATA%/suited/cache on Windows. */
export function getSuitedCacheDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'suited', 'cache');
  }
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(base, 'suited');
}

/** LinkedIn cookie persistence for `suited import <url>`. */
export function getLinkedInSessionPath(): string {
  return join(getSuitedConfigDir(), 'linkedin-session.json');
}

export function getLegacyLinkedInSessionPath(): string {
  return join(getLegacySuitedDir(), 'linkedin-session.json');
}

/** User contact fields (headline, email, …) shared across profiles. */
export function getGlobalContactMetaPath(): string {
  return join(getSuitedConfigDir(), 'contact.json');
}

/** Fetched logo SVG data URIs — shared cache. */
export function getGlobalLogoCachePath(): string {
  return join(getSuitedCacheDir(), 'logo-cache.json');
}
