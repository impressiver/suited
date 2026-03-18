import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';

const MAC_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  `${homedir()}/Applications/Chromium.app/Contents/MacOS/Chromium`,
];

const LINUX_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
];

function which(bin: string): string | null {
  try {
    return execSync(`which ${bin}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export function findChromePath(): string {
  const env = process.env['CHROME_PATH'];
  if (env) return env;

  if (process.platform === 'darwin') {
    for (const p of MAC_PATHS) {
      if (existsSync(p)) return p;
    }
    const found = which('google-chrome') ?? which('chromium');
    if (found) return found;
  } else if (process.platform === 'linux') {
    for (const p of LINUX_PATHS) {
      if (existsSync(p)) return p;
    }
    const found = which('google-chrome-stable') ?? which('google-chrome') ?? which('chromium-browser') ?? which('chromium');
    if (found) return found;
  }

  throw new Error(
    'Chrome or Chromium not found. Install Chrome, or set the CHROME_PATH environment variable.',
  );
}
