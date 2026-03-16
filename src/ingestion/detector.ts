import { access, readdir, stat } from 'fs/promises';
import { constants } from 'fs';
import { extname, join } from 'path';
import { findCsvDir } from '../utils/zip.js';

export type InputKind = 'export-zip' | 'export-dir' | 'paste-text';

export interface DetectedInput {
  kind: InputKind;
  /** For export-zip: path to zip. For export-dir: path to CSV dir. For paste-text: the raw text. */
  value: string;
}

const LINKEDIN_CSV_FILES = ['Profile.csv', 'Positions.csv', 'Education.csv', 'Skills.csv'];

export async function detectInput(input: string): Promise<DetectedInput> {
  // Check if it looks like a file path (not multi-line, not too long, no newlines)
  const looksLikePath = !input.includes('\n') && input.length < 512;

  if (looksLikePath) {
    try {
      const s = await stat(input);
      if (s.isFile() && extname(input).toLowerCase() === '.zip') {
        return { kind: 'export-zip', value: input };
      }
      if (s.isDirectory()) {
        const csvDir = await findCsvDir(input);
        if (csvDir) {
          return { kind: 'export-dir', value: csvDir };
        }
      }
    } catch {
      // Not a valid path — fall through to paste
    }
  }

  return { kind: 'paste-text', value: input };
}
