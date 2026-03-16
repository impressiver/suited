import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { TemplateName } from '../profile/schema.js';

interface PdfOptions {
  template: TemplateName;
  outputPath: string;
}

const MARGINS: Record<TemplateName, { top: string; right: string; bottom: string; left: string }> = {
  classic: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
  modern: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' },
  bold: { top: '0', right: '0', bottom: '0', left: '0' },
};

export async function exportToPdf(html: string, options: PdfOptions): Promise<void> {
  await mkdir(dirname(options.outputPath), { recursive: true });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    throw new Error(
      `Failed to launch Chrome for PDF generation: ${(err as Error).message}\n` +
      `Make sure Chrome is installed: pnpm exec puppeteer browsers install chrome`,
    );
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: options.outputPath,
      format: 'Letter',
      printBackground: true,
      margin: MARGINS[options.template],
    });
  } finally {
    await browser.close();
  }
}
