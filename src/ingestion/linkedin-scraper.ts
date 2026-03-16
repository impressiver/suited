/**
 * LinkedIn profile scraper.
 *
 * Uses Puppeteer to load a LinkedIn profile URL, handles the auth wall
 * by prompting for credentials (session cookies are persisted to avoid
 * repeated logins), scrolls to trigger lazy-loaded content, and returns
 * the profile page text for downstream Claude extraction.
 *
 * NOTE: This tool is intended for importing your own LinkedIn profile data.
 * LinkedIn's Terms of Service prohibit automated scraping of their platform.
 * Use responsibly and only on your own profile.
 */

import puppeteer, { type Browser, type Page, type CookieData } from 'puppeteer';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { fileExists } from '../utils/fs.js';

const SESSION_DIR = join(homedir(), '.resume-builder');
const SESSION_FILE = join(SESSION_DIR, 'linkedin-session.json');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

async function loadSession(): Promise<CookieData[]> {
  try {
    if (await fileExists(SESSION_FILE)) {
      const raw = await readFile(SESSION_FILE, 'utf-8');
      return JSON.parse(raw) as CookieData[];
    }
  } catch {
    // Corrupt session — ignore, will re-authenticate
  }
  return [];
}

async function saveSession(cookies: CookieData[]): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
}

export async function clearLinkedInSession(): Promise<void> {
  try {
    await writeFile(SESSION_FILE, '[]', 'utf-8');
    console.log('LinkedIn session cleared.');
  } catch {
    // File didn't exist
  }
}

// ---------------------------------------------------------------------------
// Auth wall detection
// ---------------------------------------------------------------------------

function isAuthWall(url: string): boolean {
  return (
    url.includes('linkedin.com/login') ||
    url.includes('linkedin.com/authwall') ||
    url.includes('linkedin.com/checkpoint') ||
    url.includes('linkedin.com/uas/login')
  );
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (isAuthWall(url)) return false;
  // Check for the "Sign in" button as a secondary indicator
  const signInBtn = await page.$('a[href*="/login"]');
  const navMe = await page.$('.global-nav__me');
  return navMe !== null || signInBtn === null;
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

async function login(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  console.log('  Logging in to LinkedIn...');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });

  await page.type('#username', credentials.email, { delay: 40 });
  await page.type('#password', credentials.password, { delay: 40 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
    page.click('[data-litms-control-urn="login-submit"]'),
  ]);

  const url = page.url();
  if (isAuthWall(url)) {
    throw new Error(
      'Login failed or LinkedIn is asking for a verification step. ' +
      'Try running with --no-headless to complete the challenge manually, ' +
      'then re-run the import.',
    );
  }

  // Check for 2FA / security verification page
  if (url.includes('checkpoint') || url.includes('challenge')) {
    throw new Error(
      'LinkedIn requires a security verification step (2FA / CAPTCHA). ' +
      'Run with --no-headless, complete the verification, then re-run.',
    );
  }

  console.log('  ✓ Logged in successfully');
}

// ---------------------------------------------------------------------------
// Page content extraction
// ---------------------------------------------------------------------------

async function scrollAndWait(page: Page): Promise<void> {
  // Scroll incrementally to trigger lazy-loaded sections
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalScrolled = 0;
      const step = 600;
      const interval = setInterval(() => {
        window.scrollBy(0, step);
        totalScrolled += step;
        if (totalScrolled >= document.body.scrollHeight) {
          clearInterval(interval);
          resolve();
        }
      }, 200);
    });
  });

  // Scroll back to top and give a moment for any remaining renders
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 800));
}

/** Click "see more" / "show all" expanders so full text is visible */
async function expandSections(page: Page): Promise<void> {
  const expanders = [
    // "Show all N experiences"
    'a[href*="detail/experience"]',
    // "Show all N education"
    'a[href*="detail/education"]',
    // Inline "see more" in about section
    'button[aria-label*="see more"]',
    // Skills "show all"
    'a[href*="detail/skills"]',
  ];

  for (const sel of expanders) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 3)) {
        await el.click().catch(() => {/* ignore if not clickable */});
        await new Promise(r => setTimeout(r, 400));
      }
    } catch {
      // Selector not found — fine
    }
  }
}

async function extractProfileText(page: Page): Promise<string> {
  // Try to get the main content column first; fall back to full body
  const text = await page.evaluate(() => {
    const candidates = [
      document.querySelector('main'),
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('#main-content'),
      document.body,
    ];
    for (const el of candidates) {
      if (el) {
        const t = (el as HTMLElement).innerText;
        if (t && t.length > 500) return t;
      }
    }
    return document.body.innerText;
  });

  if (!text || text.length < 100) {
    throw new Error('Extracted profile text is too short — the page may not have loaded correctly.');
  }

  return text;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface ScrapeOptions {
  /** Email + password for LinkedIn login (prompted interactively if not supplied and needed) */
  credentials?: { email: string; password: string };
  /** Show the browser window (useful for debugging or completing manual verification steps) */
  headed?: boolean;
}

export async function scrapeLinkedInProfile(
  url: string,
  options: ScrapeOptions = {},
): Promise<string> {
  // Normalise URL
  if (!url.startsWith('http')) url = `https://${url}`;

  if (!url.match(/linkedin\.com\/in\//i)) {
    throw new Error(
      `"${url}" does not look like a LinkedIn profile URL.\n` +
      'Expected format: https://www.linkedin.com/in/your-username',
    );
  }

  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: options.headed ? false : true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch(err => {
      throw new Error(
        `Failed to launch Chrome: ${(err as Error).message}\n` +
        'Run: pnpm exec puppeteer browsers install chrome',
      );
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    // Restore saved session cookies
    const savedCookies = await loadSession();
    if (savedCookies.length > 0) {
      await page.setCookie(...savedCookies);
    }

    console.log(`  Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Handle auth wall
    if (!(await isLoggedIn(page))) {
      let creds = options.credentials;

      if (!creds) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'LinkedIn email:',
            validate: (v: string) => v.includes('@') || 'Enter a valid email',
          },
          {
            type: 'password',
            name: 'password',
            message: 'LinkedIn password:',
            mask: '*',
          },
        ]);
        creds = answers as { email: string; password: string };
      }

      await login(page, creds);

      // Navigate back to the original profile after login
      console.log('  Loading profile...');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

      // Persist session so we don't need to log in next time
      const cookies = await page.cookies();
      await saveSession(cookies as CookieData[]);
      console.log(`  Session saved to ${SESSION_FILE}`);
    }

    // Final check — did we actually land on the profile?
    if (isAuthWall(page.url())) {
      throw new Error('Still on auth wall after login attempt. The credentials may be incorrect.');
    }

    await expandSections(page);
    await scrollAndWait(page);

    const text = await extractProfileText(page);
    console.log(`  ✓ Extracted ~${Math.round(text.length / 1000)}KB of profile text`);

    // Refresh saved cookies after a successful load
    const freshCookies = await page.cookies();
    await saveSession(freshCookies as CookieData[]);

    return text;
  } finally {
    await browser?.close();
  }
}
