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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type CookieData, type Page } from 'puppeteer-core';
import { throwIfAborted } from '../utils/abort.ts';
import { findChromePath } from '../utils/chrome.ts';
import { fileExists } from '../utils/fs.ts';

const SESSION_DIR = join(homedir(), '.suited');
const SESSION_FILE = join(SESSION_DIR, 'linkedin-session.json');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Session persistence — only linkedin.com cookies are saved/restored
// ---------------------------------------------------------------------------

async function loadSession(): Promise<CookieData[]> {
  try {
    if (await fileExists(SESSION_FILE)) {
      const raw = await readFile(SESSION_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as CookieData[];
    }
  } catch {
    // Corrupt session file — ignore, will re-authenticate
  }
  return [];
}

async function saveSession(cookies: CookieData[]): Promise<void> {
  // Only persist LinkedIn cookies — don't bleed third-party cookies from the session
  const linkedInCookies = cookies.filter(
    (c) => typeof c.domain === 'string' && c.domain.includes('linkedin.com'),
  );
  try {
    await mkdir(SESSION_DIR, { recursive: true });
    await writeFile(SESSION_FILE, JSON.stringify(linkedInCookies, null, 2), 'utf-8');
  } catch (err) {
    // Non-fatal: warn so the user knows why they'll be re-prompted next time
    console.warn(`  ⚠  Could not save LinkedIn session: ${(err as Error).message}`);
    console.warn(`     You will need to log in again on the next run.`);
  }
}

export async function clearLinkedInSession(): Promise<void> {
  try {
    await writeFile(SESSION_FILE, '[]', 'utf-8');
    console.log('LinkedIn session cleared.');
  } catch {
    // File didn't exist — nothing to do
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

/**
 * Returns true only when we're confident we have an authenticated session:
 * the user-menu element is present AND no sign-in link is visible.
 * Both conditions must hold — a partially-rendered page fails this check
 * and triggers a login attempt rather than silently proceeding.
 */
async function isLoggedIn(page: Page): Promise<boolean> {
  if (isAuthWall(page.url())) return false;
  const navMe = await page.$('.global-nav__me');
  const signInBtn = await page.$('a[href*="/login"]');
  return navMe !== null && signInBtn === null;
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

async function login(page: Page, credentials: { email: string; password: string }): Promise<void> {
  console.log('  Logging in to LinkedIn...');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });

  // Confirm the login form is actually present before typing
  try {
    await page.waitForSelector('#username', { timeout: 10_000 });
  } catch {
    throw new Error(
      'LinkedIn login form did not load. The page may have changed or your network is blocking LinkedIn.',
    );
  }

  await page.type('#username', credentials.email, { delay: 40 });
  await page.type('#password', credentials.password, { delay: 40 });

  // Wait for the submit button and confirm it exists before clicking
  const submitSel = 'button[data-litms-control-urn="login-submit"], button[type="submit"]';
  try {
    await page.waitForSelector(submitSel, { timeout: 5_000 });
  } catch {
    throw new Error(
      'LinkedIn login submit button not found. The login page layout may have changed.',
    );
  }

  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
      page.click(submitSel),
    ]);
  } catch (err) {
    // Distinguish timeout (page never navigated) from other errors
    if ((err as Error).message?.includes('timeout')) {
      throw new Error(
        'LinkedIn did not redirect after login — the credentials may be wrong, ' +
          'or LinkedIn is showing a CAPTCHA. Re-run with --headed to complete it manually.',
      );
    }
    throw err;
  }

  const url = page.url();

  if (url.includes('checkpoint') || url.includes('challenge')) {
    throw new Error(
      'LinkedIn requires a security verification step (2FA / CAPTCHA). ' +
        'Re-run with --headed to complete it manually.',
    );
  }

  if (isAuthWall(url)) {
    throw new Error(
      'Login failed — incorrect credentials or LinkedIn is blocking the login. ' +
        'Double-check your email and password.',
    );
  }

  console.log('  ✓ Logged in');
}

// ---------------------------------------------------------------------------
// Page content extraction
// ---------------------------------------------------------------------------

async function scrollAndWait(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * Click inline "see more" / "show more" buttons that expand content in place.
 * These are buttons within individual entries — they do NOT navigate the page.
 * Navigation links ("Show all N experiences") are handled separately by visiting
 * each detail sub-page.
 */
async function expandInlineContent(page: Page): Promise<void> {
  const buttonSelectors = [
    'button[aria-label*="see more"]',
    'button[aria-label*="See more"]',
    'button[aria-label*="show more"]',
    'button[aria-label*="Show more"]',
    // Inline text clamp expanders used in experience/education entries
    '.inline-show-more-text__button',
    'button.lt-line-clamp__more',
  ];

  for (const sel of buttonSelectors) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        await el.click().catch(() => {
          /* detached or obscured — skip */
        });
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch {
      // Selector absent on this profile — fine
    }
  }
}

/**
 * Collect all "Show all {section}" detail sub-page URLs present on the current page.
 * These are anchor tags whose href contains "/details/" and lead to full section views.
 * Typical examples:
 *   /in/{username}/details/experience/
 *   /in/{username}/details/skills/
 *   /in/{username}/details/projects/
 *   /in/{username}/details/recommendations/
 */
async function collectDetailUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const a of Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/details/"]'),
    )) {
      // Normalize: strip query-string and fragment, ensure trailing slash
      const normalized = a.href.split('?')[0].split('#')[0].replace(/\/*$/, '/');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    }
    return urls;
  });
}

/**
 * On LinkedIn detail pages (e.g. /details/skills/) there is sometimes a
 * "Load more results" button for pagination. Click it repeatedly until it
 * disappears, then scroll to trigger any remaining lazy-loaded items.
 */
async function loadAllOnDetailPage(page: Page): Promise<void> {
  const loadMoreSel = [
    'button[aria-label*="Load more"]',
    'button[aria-label*="load more"]',
    'button.scaffold-finite-scroll__load-button',
  ];

  // Click "Load more" up to 20 times to avoid infinite loops on huge lists
  for (let i = 0; i < 20; i++) {
    let clicked = false;
    for (const sel of loadMoreSel) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await new Promise((r) => setTimeout(r, 1_200));
          clicked = true;
          break;
        }
      } catch {
        /* gone — fine */
      }
    }
    if (!clicked) break;
  }

  await expandInlineContent(page);
  await scrollAndWait(page);
}

/** Extract the text content from a detail sub-page. */
async function extractDetailPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates: (Element | null)[] = [
      document.querySelector('main'),
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('#main-content'),
      document.body,
    ];
    for (const el of candidates) {
      const t = el ? (el as HTMLElement).innerText : '';
      if (t && t.length > 100) return t;
    }
    return '';
  });
}

/**
 * Heuristic check that the extracted text looks like a profile, not a login/error page.
 * LinkedIn's auth wall and error pages contain 500+ characters too, so we can't
 * rely on length alone.
 */
function assertLooksLikeProfile(text: string, originalUrl: string): void {
  const lower = text.toLowerCase();

  const loginSignals = [
    'sign in to linkedin',
    'email or phone',
    'forgot password',
    'join now',
    'create an account',
  ];
  for (const signal of loginSignals) {
    if (lower.includes(signal)) {
      throw new Error(
        `The extracted page text looks like a login or redirect page, not a profile.\n` +
          `Matched phrase: "${signal}"\n` +
          `The session may have expired. Re-run with --clear-session to re-authenticate.`,
      );
    }
  }

  const profileSignals = ['experience', 'education', 'skills', 'about'];
  const hasProfileContent = profileSignals.some((s) => lower.includes(s));
  if (!hasProfileContent) {
    throw new Error(
      `The extracted page text does not contain recognisable profile sections ` +
        `(experience, education, skills, about).\n` +
        `URL: ${originalUrl}\n` +
        `Check that the URL points to a public LinkedIn profile.`,
    );
  }
}

async function extractProfileText(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    // Prefer the main content column; fall back to full body
    const candidates: (Element | null)[] = [
      document.querySelector('main'),
      document.querySelector('.scaffold-layout__main'),
      document.querySelector('#main-content'),
      document.body ?? null,
    ];
    for (const el of candidates) {
      if (el) {
        const t = (el as HTMLElement).innerText;
        if (t && t.length > 500) return t;
      }
    }
    return (document.body ?? document.documentElement).innerText ?? '';
  });

  if (!text || text.length < 100) {
    throw new Error(
      'Extracted profile text is too short — the page may not have loaded correctly.',
    );
  }

  return text;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

// Require scheme + linkedin.com/in/ + at least one non-slash character as username
const LINKEDIN_PROFILE_RE = /^https?:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#\s]+)/i;

function validateAndNormaliseUrl(raw: string): string {
  const url = raw.startsWith('http') ? raw : `https://${raw}`;
  const m = url.match(LINKEDIN_PROFILE_RE);
  if (!m || !m[1]) {
    throw new Error(
      `"${raw}" does not look like a LinkedIn profile URL.\n` +
        'Expected format: https://www.linkedin.com/in/your-username',
    );
  }
  // Strip query-string and fragments — use only the canonical profile URL
  return `https://www.linkedin.com/in/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Profile navigation
// ---------------------------------------------------------------------------

/**
 * Navigate to a LinkedIn profile page and wait for the main content to render.
 *
 * `networkidle2` is intentionally avoided: LinkedIn keeps WebSocket /
 * long-polling connections open indefinitely, so that event never fires on
 * their SPA. We wait for the DOM to load and then for the <main> element to
 * appear instead.
 */
async function gotoProfile(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  try {
    await page.waitForSelector('main, .scaffold-layout__main, #main-content', {
      timeout: 20_000,
    });
  } catch {
    // Page loaded but expected element absent — extractProfileText will surface
    // the real problem (too short, wrong content) with a clearer message.
  }
}

// ---------------------------------------------------------------------------
// Manual login (headed mode)
// ---------------------------------------------------------------------------

/**
 * In headed mode the user drives the browser themselves.
 * Poll until LinkedIn's nav shows an authenticated session, then return.
 * Times out after 5 minutes.
 */
async function waitForManualLogin(page: Page, signal?: AbortSignal): Promise<void> {
  console.log('  Browser is open — log in to LinkedIn in the browser window...');

  const POLL_MS = 2_000;
  const TIMEOUT_MS = 5 * 60 * 1_000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await new Promise((r) => setTimeout(r, POLL_MS));
    // li_at is LinkedIn's primary session cookie — present immediately after
    // a successful login regardless of which page the browser has landed on.
    const cookies = await page.cookies('https://www.linkedin.com');
    if (cookies.some((c) => c.name === 'li_at')) {
      console.log('  ✓ Logged in');
      return;
    }
  }

  throw new Error('Timed out waiting for manual login (5 minutes). Re-run to try again.');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface ScrapeOptions {
  credentials?: { email: string; password: string };
  /** Show the browser window (useful for 2FA / CAPTCHA) */
  headed?: boolean;
  /** When aborted (e.g. TUI Esc), scraper stops between navigation steps. */
  signal?: AbortSignal;
}

export async function scrapeLinkedInProfile(
  rawUrl: string,
  options: ScrapeOptions = {},
): Promise<string> {
  const url = validateAndNormaliseUrl(rawUrl);
  const { signal } = options;
  throwIfAborted(signal);

  let browser: Browser | undefined;

  try {
    browser = await puppeteer
      .launch({
        headless: !options.headed,
        executablePath: findChromePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .catch((err) => {
        throw new Error(
          `Failed to launch Chrome: ${(err as Error).message}\n` +
            'Make sure Chrome is installed, or set the CHROME_PATH environment variable.',
        );
      });

    throwIfAborted(signal);

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    // Restore saved session cookies
    const savedCookies = await loadSession();
    if (savedCookies.length > 0) {
      await page.setCookie(...(savedCookies as Parameters<typeof page.setCookie>));
    }

    console.log(`  Navigating to ${url} ...`);
    await gotoProfile(page, url);
    throwIfAborted(signal);

    // Handle auth wall — in headed mode, wait for the user to log in manually;
    // in headless mode, prompt for credentials and drive the login form.
    if (!(await isLoggedIn(page))) {
      if (options.headed) {
        await waitForManualLogin(page, signal);
      } else {
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
      }

      console.log('  Loading profile...');
      await gotoProfile(page, url);
      throwIfAborted(signal);

      // Save session after confirmed successful navigation to the profile
      await saveSession((await page.cookies()) as CookieData[]);
      console.log(`  Session saved to ${SESSION_FILE}`);
    }

    // Guard: confirm we're on the profile, not an auth wall or error page
    if (isAuthWall(page.url())) {
      throw new Error(
        'Landed on an auth wall after navigating to the profile. ' +
          'Run with --clear-session to force re-authentication.',
      );
    }

    // Step 1: expand inline content on profile page, scroll, extract main profile text
    throwIfAborted(signal);
    await expandInlineContent(page);
    await scrollAndWait(page);
    throwIfAborted(signal);

    const profileText = await extractProfileText(page);
    assertLooksLikeProfile(profileText, url);

    // Step 2: collect all "Show all {section}" detail sub-page links
    const detailUrls = await collectDetailUrls(page);
    console.log(
      `  Found ${detailUrls.length} detail section(s): ${detailUrls
        .map((u) => u.match(/\/details\/([^/]+)/)?.[1] ?? u)
        .join(', ')}`,
    );

    // Step 3: visit each detail page and extract its full content
    const sectionTexts: string[] = [profileText];
    for (const detailUrl of detailUrls) {
      throwIfAborted(signal);
      const sectionName = detailUrl.match(/\/details\/([^/]+)/)?.[1] ?? 'section';
      console.log(`  Scraping ${sectionName}...`);
      try {
        await gotoProfile(page, detailUrl);

        // Guard: bail if we hit an auth wall mid-scrape
        if (isAuthWall(page.url())) {
          console.warn(`  ⚠  Auth wall on ${detailUrl} — skipping section`);
          continue;
        }

        await loadAllOnDetailPage(page);
        const sectionText = await extractDetailPageText(page);
        if (sectionText.length > 100) sectionTexts.push(sectionText);
      } catch (err) {
        console.warn(`  ⚠  Could not scrape ${sectionName}: ${(err as Error).message}`);
      }
    }

    const text = sectionTexts.join('\n\n---\n\n');

    console.log(`  ✓ Extracted ~${Math.round(text.length / 1000)}KB of profile text`);

    // Refresh cookies once — after a fully successful scrape
    await saveSession((await page.cookies()) as CookieData[]);

    return text;
  } finally {
    await browser?.close();
  }
}
