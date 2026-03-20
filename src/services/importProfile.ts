import { type DetectedInput, detectInput } from '../ingestion/detector.ts';
import { parseLinkedInExport } from '../ingestion/linkedin-export.ts';
import { parseLinkedInPaste } from '../ingestion/linkedin-paste.ts';
import { scrapeLinkedInProfile } from '../ingestion/linkedin-scraper.ts';
import { profileToMarkdown } from '../profile/markdown.ts';
import type { Profile } from '../profile/schema.ts';
import {
  loadContactMeta,
  mergeContactMeta as mergeContactMetaIntoProfile,
  saveSource,
  sourceMdPath,
} from '../profile/serializer.ts';
import { extractZip, findCsvDir } from '../utils/zip.ts';

export interface ImportProfileOptions {
  input: string;
  profileDir: string;
  headed?: boolean;
  /** Optional progress hook (CLI uses chalk; TUI omits). */
  onPhase?: (message: string) => void;
  /** Cooperative cancel (TUI Esc) for URL scrape + Claude parse paths. */
  signal?: AbortSignal;
}

export interface ImportProfileResult {
  detected: DetectedInput;
  profile: Profile;
}

/**
 * Core import pipeline (URL, ZIP, directory, or pasted text) without Inquirer or console output.
 * Callers persist summary UX; this only loads/normalizes and writes source + markdown.
 */
export async function importProfileFromInput(
  options: ImportProfileOptions,
): Promise<ImportProfileResult> {
  const { input, profileDir, headed, onPhase, signal } = options;
  const detected = await detectInput(input.trim());

  let profile: Profile;

  if (detected.kind === 'linkedin-url') {
    onPhase?.('Scraping LinkedIn profile...');
    const pageText = await scrapeLinkedInProfile(detected.value, { headed, signal });
    onPhase?.('Extracting data with Claude (verbatim only, no embellishment)...');
    profile = await parseLinkedInPaste(pageText, signal);
  } else if (detected.kind === 'export-zip') {
    onPhase?.('Unzipping the goods...');
    const extracted = await extractZip(detected.value);
    const found = await findCsvDir(extracted);
    if (!found) {
      throw new Error('No CSV files found in the ZIP archive.');
    }
    onPhase?.('Parsing LinkedIn export (no AI, just raw data)...');
    profile = await parseLinkedInExport(found);
  } else if (detected.kind === 'export-dir') {
    onPhase?.('Parsing LinkedIn export (no AI used)...');
    profile = await parseLinkedInExport(detected.value);
  } else {
    onPhase?.('Parsing with Claude (verbatim extraction only)...');
    profile = await parseLinkedInPaste(detected.value, signal);
  }

  const contactMeta = await loadContactMeta(profileDir);
  profile = mergeContactMetaIntoProfile(profile, contactMeta);

  await saveSource(profile, profileDir);
  await profileToMarkdown(profile, sourceMdPath(profileDir));

  return { detected, profile };
}
