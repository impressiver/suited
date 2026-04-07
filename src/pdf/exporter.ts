import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { TemplateName } from '../profile/schema.ts';
import { findChromePath } from '../utils/chrome.ts';

/** Resume templates plus dedicated cover letter PDF layout (US Letter; same margins map). */
export type PdfExportTemplate = TemplateName | 'cover-letter';

interface PdfOptions {
  template: PdfExportTemplate;
  outputPath: string;
  /** PDF render scale 0.1–2.0. Defaults to 1. Use <1 to shrink content to fit one page. */
  scale?: number;
}

export interface PageFitResult {
  overflows: boolean;
  /** scrollHeight / clientHeight. >1 means content is clipped. */
  ratio: number;
}

// Margins are controlled entirely by CSS (body padding / @page rules).
// Setting Puppeteer margins to zero prevents double-application.
const MARGINS: Record<
  PdfExportTemplate,
  { top: string; right: string; bottom: string; left: string }
> = {
  classic: { top: '0', right: '0', bottom: '0', left: '0' },
  modern: { top: '0', right: '0', bottom: '0', left: '0' },
  bold: { top: '0', right: '0', bottom: '0', left: '0' },
  retro: { top: '0', right: '0', bottom: '0', left: '0' },
  timeline: { top: '0', right: '0', bottom: '0', left: '0' },
  'cover-letter': { top: '0', right: '0', bottom: '0', left: '0' },
};

function launchBrowser() {
  try {
    return puppeteer.launch({
      headless: true,
      executablePath: findChromePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    throw new Error(
      `Failed to launch Chrome: ${(err as Error).message}\n` +
        `Make sure Chrome is installed, or set the CHROME_PATH environment variable.`,
    );
  }
}

// Letter paper at CSS 96 dpi: 8.5 × 11 in = 816 × 1056 px.
// Setting the viewport to these dimensions before layout ensures the HTML
// is computed at the same width as the PDF page, so content fills the
// full page width with no right-side gap.
const LETTER_VIEWPORT = { width: 816, height: 1056 };

/**
 * Measures whether the rendered HTML fits within one printed page.
 * Returns the ratio of content height to page height (>1 = clipped).
 */
export async function measurePageFit(html: string): Promise<PageFitResult> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(LETTER_VIEWPORT);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const { scrollH, clientH } = await page.evaluate(() => ({
      scrollH: document.body.scrollHeight,
      clientH: document.body.clientHeight,
    }));
    return {
      overflows: scrollH > clientH,
      ratio: clientH > 0 ? scrollH / clientH : 1,
    };
  } finally {
    await browser.close();
  }
}

export async function exportToPdf(html: string, options: PdfOptions): Promise<void> {
  await mkdir(dirname(options.outputPath), { recursive: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(LETTER_VIEWPORT);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: options.outputPath,
      format: 'Letter',
      printBackground: true,
      margin: MARGINS[options.template],
      scale: options.scale ?? 1,
    });
  } finally {
    await browser.close();
  }
}
