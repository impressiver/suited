import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { TemplateName } from '../profile/schema.js';

interface PdfOptions {
  template: TemplateName;
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
const MARGINS: Record<TemplateName, { top: string; right: string; bottom: string; left: string }> = {
  classic: { top: '0', right: '0', bottom: '0', left: '0' },
  modern:  { top: '0', right: '0', bottom: '0', left: '0' },
  bold:    { top: '0', right: '0', bottom: '0', left: '0' },
  retro:   { top: '0', right: '0', bottom: '0', left: '0' },
};

function launchBrowser() {
  try {
    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    throw new Error(
      `Failed to launch Chrome: ${(err as Error).message}\n` +
      `Make sure Chrome is installed: npx puppeteer browsers install chrome`,
    );
  }
}

/**
 * Measures whether the rendered HTML fits within one printed page.
 * Returns the ratio of content height to page height (>1 = clipped).
 */
export async function measurePageFit(html: string): Promise<PageFitResult> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
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
