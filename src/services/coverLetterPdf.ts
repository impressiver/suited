import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coverLetterMarkdownToHtml,
  normalizeCoverLetterNewlines,
} from '../coverLetter/markdownToHtml.ts';
import { exportToPdf } from '../pdf/exporter.ts';
import type { Profile } from '../profile/schema.ts';
import { coverLetterMdPath } from '../profile/serializer.ts';
import { fileExists } from '../utils/fs.ts';

const TEMPLATES_DIR = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  } catch {
    return '';
  }
})();

async function loadCoverLetterCss(): Promise<string> {
  try {
    const { isSea, getAsset } = await import('node:sea');
    if (isSea()) {
      return getAsset('templates/cover-letter/style.css', 'utf8') as string;
    }
  } catch {
    // fall through
  }
  return readFile(join(TEMPLATES_DIR, 'cover-letter', 'style.css'), 'utf-8');
}

function safePersonSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isCoverLetterDraftNonEmpty(markdown: string): boolean {
  return normalizeCoverLetterNewlines(markdown).trim().length > 0;
}

export async function saveCoverLetterDraft(
  profileDir: string,
  jobSlug: string,
  body: string,
): Promise<void> {
  const path = coverLetterMdPath(profileDir, jobSlug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalizeCoverLetterNewlines(body), 'utf-8');
}

export async function readCoverLetterDraft(
  profileDir: string,
  jobSlug: string,
): Promise<string | null> {
  const path = coverLetterMdPath(profileDir, jobSlug);
  if (!(await fileExists(path))) {
    return null;
  }
  const raw = await readFile(path, 'utf-8');
  const normalized = normalizeCoverLetterNewlines(raw);
  if (!isCoverLetterDraftNonEmpty(normalized)) {
    return null;
  }
  return normalized;
}

export interface BuildCoverLetterHtmlOptions {
  profile: Profile;
  /** Job context for letterhead (optional). */
  company?: string;
  jobTitle?: string;
  /** Markdown body; must be non-empty after trim for export. */
  bodyMarkdown: string;
}

export async function buildCoverLetterHtmlDocument(
  opts: BuildCoverLetterHtmlOptions,
): Promise<string> {
  const css = await loadCoverLetterCss();
  const { profile, company, jobTitle } = opts;
  const bodyHtml = coverLetterMarkdownToHtml(opts.bodyMarkdown);
  const name = profile.contact.name.value;
  const email = profile.contact.email?.value;
  const phone = profile.contact.phone?.value;
  const location = profile.contact.location?.value;

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const fromLines = [name, email, phone, location].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  );

  const toLines: string[] = [];
  if (company?.trim()) {
    toLines.push(`<strong>${escapeAttrText(company.trim())}</strong>`);
  }
  if (jobTitle?.trim()) {
    toLines.push(`Re: ${escapeAttrText(jobTitle.trim())}`);
  }

  const salutation = company?.trim()
    ? `Dear ${escapeHtmlText(company.trim())} team,`
    : 'Dear Hiring Manager,';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
${css}
  </style>
</head>
<body class="cover-letter">
  <div class="letter-meta">
    <div class="letter-date">${escapeHtmlText(dateStr)}</div>
    <div class="letter-from">${fromLines.map((l) => escapeHtmlText(l)).join('<br>\n')}</div>
    ${toLines.length > 0 ? `<div class="letter-to">${toLines.join('<br>\n')}</div>` : ''}
  </div>
  <div class="letter-salutation">${salutation}</div>
  <div class="letter-body">${bodyHtml}</div>
  <div class="letter-closing">Sincerely,</div>
  <div class="letter-signature">${escapeHtmlText(name)}</div>
</body>
</html>`;
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttrText(s: string): string {
  return escapeHtmlText(s);
}

export function buildCoverLetterOutputPath(
  profile: Profile,
  jobSlug: string,
  resumesDir: string,
): string {
  const personSlug = safePersonSlug(profile.contact.name.value);
  const nowTs = new Date();
  const date = nowTs.toISOString().slice(0, 10);
  const hhmm = nowTs.toTimeString().slice(0, 5).replace(':', '');
  const sub = jobSlug ? `${resumesDir}/${jobSlug}` : resumesDir;
  return `${sub}/${personSlug}-cover-letter_${date}-${hhmm}.pdf`;
}

export interface ExportCoverLetterPdfOptions {
  profileDir: string;
  resumesDir?: string;
  jobSlug: string;
  profile: Profile;
  company?: string;
  jobTitle?: string;
}

/**
 * Reads `jobs/{slug}/cover-letter.md`, renders HTML, exports PDF. Throws if missing or empty.
 */
export async function exportCoverLetterPdf(opts: ExportCoverLetterPdfOptions): Promise<string> {
  const draft = await readCoverLetterDraft(opts.profileDir, opts.jobSlug);
  if (draft == null) {
    throw new Error(
      `Cover letter is missing or empty. Add text to jobs/${opts.jobSlug}/cover-letter.md first.`,
    );
  }
  const html = await buildCoverLetterHtmlDocument({
    profile: opts.profile,
    company: opts.company,
    jobTitle: opts.jobTitle,
    bodyMarkdown: draft,
  });
  const resumesDir = opts.resumesDir ?? 'resumes';
  const outputPath = buildCoverLetterOutputPath(opts.profile, opts.jobSlug, resumesDir);
  await exportToPdf(html, { template: 'cover-letter', outputPath });
  return outputPath;
}
