import AdmZip from 'adm-zip';
import { writeFile, mkdir, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export async function extractZip(zipPath: string): Promise<string> {
  const outDir = join(tmpdir(), `resume-${randomBytes(6).toString('hex')}`);
  await mkdir(outDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  return outDir;
}

export async function findCsvDir(dirPath: string): Promise<string | null> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.csv')) {
        return dirPath;
      }
      if (entry.isDirectory()) {
        const nested = await findCsvDir(join(dirPath, entry.name));
        if (nested) return nested;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
