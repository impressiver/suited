/**
 * HTTP utilities for finding and fetching SVG content.
 * Does not do any logo classification — see logo-extractor.ts for that.
 *
 * Candidate ordering (most logomark-like first):
 *   1. /favicon.svg
 *   2. Inline <svg> elements in logo-context (header, nav, id/class "logo"/"brand")
 *   3. Linked SVG files from <link> icon tags
 *   4. Other .svg references in img src / href attributes
 */

const UA = 'Mozilla/5.0 (compatible; suited/1.0)';
const TIMEOUT_MS = 7000;
const MAX_SVG_BYTES = 100_000;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

async function tryFetch(url: string): Promise<Response | undefined> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA },
    });
    return res.ok ? res : undefined;
  } catch {
    return undefined;
  }
}

function mimeType(res: Response): string {
  return (res.headers.get('content-type') ?? '').split(';')[0].trim();
}

function resolveHref(href: string, origin: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
}

function looksLikeSvg(text: string): boolean {
  const s = text.trimStart();
  return s.startsWith('<svg') || s.startsWith('<?xml') || s.includes('<svg ');
}

function fitsInLimit(text: string): boolean {
  return Buffer.byteLength(text) <= MAX_SVG_BYTES;
}

// ---------------------------------------------------------------------------
// Inline SVG extraction
// ---------------------------------------------------------------------------

/**
 * Extracts inline <svg>...</svg> blocks from an HTML string.
 * Uses a depth-tracking scan to handle nested SVG elements correctly.
 * Returns [svgContent, contextBefore] pairs — context used for prioritisation.
 */
function extractInlineSvgs(html: string): Array<{ svg: string; context: string }> {
  const results: Array<{ svg: string; context: string }> = [];
  let pos = 0;

  while (pos < html.length) {
    const start = html.indexOf('<svg', pos);
    if (start === -1) break;

    // Make sure it's an actual <svg tag, not e.g. <svg-icon custom element
    const charAfter = html[start + 4];
    if (charAfter !== ' ' && charAfter !== '\n' && charAfter !== '\t' && charAfter !== '>') {
      pos = start + 4;
      continue;
    }

    // Walk forward tracking open/close depth
    let depth = 0;
    let i = start;
    while (i < html.length) {
      if (html.startsWith('<svg', i) && (html[i + 4] === ' ' || html[i + 4] === '\n' || html[i + 4] === '\t' || html[i + 4] === '>')) {
        depth++;
        i += 4;
      } else if (html.startsWith('</svg>', i)) {
        depth--;
        i += 6;
        if (depth === 0) break;
      } else {
        i++;
      }
    }

    if (depth === 0) {
      const svg = html.slice(start, i);
      if (svg.length > 80 && fitsInLimit(svg)) {
        // 300 chars of context before the SVG — used to detect logo placement
        const context = html.slice(Math.max(0, start - 300), start);
        results.push({ svg, context });
      }
    }

    pos = i;
  }

  return results;
}

/** Returns true if the surrounding HTML context suggests this SVG is a logo. */
function isLogoContext(context: string): boolean {
  return /logo|brand|wordmark|header|navbar|nav\b/i.test(context);
}

// ---------------------------------------------------------------------------
// SVG candidate collection from an HTML page
// ---------------------------------------------------------------------------

async function svgsFromHtml(html: string, origin: string): Promise<string[]> {
  // --- Inline SVGs (logo-context first, then rest) ---
  const inlineSvgs = extractInlineSvgs(html);
  const inlineLogo  = inlineSvgs.filter(e => isLogoContext(e.context)).map(e => e.svg);
  const inlineOther = inlineSvgs.filter(e => !isLogoContext(e.context)).map(e => e.svg);

  // --- Linked SVG files ---
  const linkedUrls = new Set<string>();

  // <link> icon tags with SVG type or .svg href
  for (const tag of html.matchAll(/<link[^>]+>/gi)) {
    const t = tag[0];
    if (!/rel=["'][^"']*icon[^"']*["']/i.test(t)) continue;
    const href = t.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    if (/type=["'][^"']*svg[^"']*["']/i.test(t) || href.toLowerCase().includes('.svg')) {
      linkedUrls.add(resolveHref(href, origin));
    }
  }

  // <img src="*.svg"> and other .svg src/href — prefer those with "logo" in the attribute
  const logoPriority: string[] = [];
  const otherLinked: string[] = [];

  for (const m of html.matchAll(/(?:src|href)=["']([^"']*\.svg[^"'?#]*)/gi)) {
    const url = resolveHref(m[1], origin);
    if (linkedUrls.has(url)) continue; // already captured via <link>
    // A bit of context before the match to detect logo intent
    const ctx = html.slice(Math.max(0, m.index! - 100), m.index!);
    if (/logo|brand|header|nav/i.test(ctx) || /logo|brand/i.test(m[1])) {
      logoPriority.push(url);
    } else {
      otherLinked.push(url);
    }
  }

  const linkedFetches = [...linkedUrls, ...logoPriority, ...otherLinked];
  const fetched: string[] = [];
  for (const url of linkedFetches) {
    if (fetched.length >= 4) break;
    const res = await tryFetch(url);
    if (!res) continue;
    const mime = mimeType(res);
    if (!mime.includes('svg') && !mime.includes('xml')) continue;
    const text = await res.text();
    if (looksLikeSvg(text) && fitsInLimit(text)) fetched.push(text);
  }

  // Ordered: inline logo-context → linked files → other inline
  return [...inlineLogo, ...fetched, ...inlineOther];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch SVG content strings from a URL — handles direct .svg files and HTML pages. */
export async function fetchSvgsFromUrl(rawUrl: string): Promise<string[]> {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const res = await tryFetch(url);
  if (!res) return [];

  const mime = mimeType(res);
  const text = await res.text();

  // Direct SVG file
  if (mime.includes('svg') || looksLikeSvg(text)) {
    if (fitsInLimit(text)) return [text];
    return [];
  }

  // Scrape for SVGs — treat any non-SVG response as a page to scan,
  // regardless of content-type (handles wrong MIME types and brand pages)
  if (mime.includes('html') || text.includes('<') ) {
    const origin = new URL(url).origin;

    // /favicon.svg first — highest chance of being a clean logomark
    const faviconRes = await tryFetch(`${origin}/favicon.svg`);
    const faviconSvgs: string[] = [];
    if (faviconRes) {
      const ftext = await faviconRes.text();
      if (looksLikeSvg(ftext) && fitsInLimit(ftext)) faviconSvgs.push(ftext);
    }

    const pageSvgs = await svgsFromHtml(text, origin);
    return [...faviconSvgs, ...pageSvgs];
  }

  return [];
}

/** Auto-discover SVG candidates for a company name using domain guessing. */
export async function discoverLogoSvgs(name: string): Promise<string[]> {
  const domain = domainFor(name);
  return fetchSvgsFromUrl(`https://${domain}`);
}

// ---------------------------------------------------------------------------
// Domain guessing
// ---------------------------------------------------------------------------

export function domainFor(name: string): string {
  const tldMatch = name.match(/(\S+)\.(ai|io|co|org|net|edu|dev|app|com)\b/i);
  if (tldMatch) return `${tldMatch[1]}.${tldMatch[2]}`.toLowerCase();
  return name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
}
