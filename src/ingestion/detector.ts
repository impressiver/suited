import { stat } from 'fs/promises';
import { extname } from 'path';
import { findCsvDir } from '../utils/zip.js';

export type InputKind = 'linkedin-url' | 'export-zip' | 'export-dir' | 'paste-text';

export interface DetectedInput {
  kind: InputKind;
  /** Normalised value: URL string, file path, or raw pasted text */
  value: string;
}

const LINKEDIN_PROFILE_RE = /^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^/\s]+/i;

export async function detectInput(input: string): Promise<DetectedInput> {
  const trimmed = input.trim();

  // LinkedIn profile URL — check before file-path heuristic so
  // "linkedin.com/in/..." isn't mistaken for a local path
  if (LINKEDIN_PROFILE_RE.test(trimmed)) {
    return { kind: 'linkedin-url', value: trimmed };
  }

  // Possible file path: single line, reasonable length, no newlines
  const looksLikePath = !trimmed.includes('\n') && trimmed.length < 512;

  if (looksLikePath) {
    try {
      const s = await stat(trimmed);
      if (s.isFile() && extname(trimmed).toLowerCase() === '.zip') {
        return { kind: 'export-zip', value: trimmed };
      }
      if (s.isDirectory()) {
        const csvDir = await findCsvDir(trimmed);
        if (csvDir) {
          return { kind: 'export-dir', value: csvDir };
        }
      }
    } catch {
      // Not a valid path — fall through to paste
    }
  }

  return { kind: 'paste-text', value: trimmed };
}
