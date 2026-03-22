import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from '../utils/fs.ts';
import type { RefinedData } from './schema.ts';
import { stableStringify } from './stableJson.ts';

/** Top-level directory name under the profile dir (see specs/refinement-history.md §3.1). */
export const REFINED_HISTORY_DIR_NAME = 'refined-history';

export const REFINEMENT_HISTORY_SCHEMA_VERSION = 'refined-history-v1';

/** Default max snapshots retained; oldest pruned first (§6). */
export const DEFAULT_REFINEMENT_HISTORY_MAX = 50;

export type RefinementSaveReason =
  | 'qa-save'
  | 'polish'
  | 'consultant'
  | 'direct-edit'
  | 'profile-editor'
  | 'md-sync'
  | 'improve'
  | 'contact-merge'
  | 'generate-md-sync'
  | 'manual-restore'
  | 'unspecified';

export interface RefinementSnapshotEnvelope {
  schemaVersion: typeof REFINEMENT_HISTORY_SCHEMA_VERSION;
  id: string;
  savedAt: string;
  reason: RefinementSaveReason;
  /** Present when reason is manual-restore (§5). */
  restoreSourceId?: string;
  data: RefinedData;
}

export interface RefinementHistoryListEntry {
  id: string;
  savedAt: string;
  reason: RefinementSaveReason;
  restoreSourceId?: string;
}

let pruningNoticeShownThisProcess = false;

export function refinedHistoryDir(profileDir: string): string {
  return join(profileDir, REFINED_HISTORY_DIR_NAME);
}

/** Full canonical JSON including `profile.updatedAt` (e.g. tests, debugging). */
export function canonicalRefinedDataJson(data: RefinedData): string {
  return stableStringify(data);
}

/**
 * Equality check for §4 / §89: ignore top-level profile.updatedAt so markdown reload that does not
 * change substantive profile + session does not append a snapshot or rewrite files.
 */
export function refinedDataIdentityCanon(data: RefinedData): string {
  const { updatedAt: _u, ...profileRest } = data.profile;
  return stableStringify({ profile: profileRest, session: data.session });
}

function snapshotFilePath(profileDir: string, id: string): string {
  return join(refinedHistoryDir(profileDir), `${id}.json`);
}

async function nextSnapshotId(profileDir: string): Promise<string> {
  const dir = refinedHistoryDir(profileDir);
  if (!(await fileExists(dir))) return '1';
  const names = await readdir(dir);
  let max = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const stem = name.slice(0, -'.json'.length);
    const n = Number.parseInt(stem, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

async function pruneOldestIfNeeded(profileDir: string, maxCount: number): Promise<void> {
  const dir = refinedHistoryDir(profileDir);
  if (!(await fileExists(dir))) return;
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
  const ids = names
    .map((n) => n.slice(0, -'.json'.length))
    .filter((id) => /^\d+$/.test(id))
    .map((id) => Number.parseInt(id, 10))
    .sort((a, b) => a - b);
  if (ids.length <= maxCount) return;
  const toRemove = ids.length - maxCount;
  if (!pruningNoticeShownThisProcess) {
    pruningNoticeShownThisProcess = true;
    console.warn(
      `[suited] Refined history: removed ${toRemove} oldest snapshot(s) (cap ${maxCount} in ${REFINED_HISTORY_DIR_NAME}/).`,
    );
  }
  for (let i = 0; i < toRemove; i++) {
    const id = ids[i];
    await unlink(snapshotFilePath(profileDir, String(id))).catch(() => {});
  }
}

/**
 * Persist a snapshot of `previous` before it is replaced (§3.3–§4). Caller must only call when
 * refined.json already exists and the pending write is canonically different.
 */
export async function commitRefinementSnapshot(
  profileDir: string,
  previous: RefinedData,
  reason: RefinementSaveReason,
  options?: { restoreSourceId?: string; maxSnapshots?: number },
): Promise<void> {
  const dir = refinedHistoryDir(profileDir);
  await mkdir(dir, { recursive: true });
  const id = await nextSnapshotId(profileDir);
  const envelope: RefinementSnapshotEnvelope = {
    schemaVersion: REFINEMENT_HISTORY_SCHEMA_VERSION,
    id,
    savedAt: new Date().toISOString(),
    reason,
    ...(options?.restoreSourceId !== undefined ? { restoreSourceId: options.restoreSourceId } : {}),
    data: previous,
  };
  const finalPath = snapshotFilePath(profileDir, id);
  const tmpName = `.tmp-${randomBytes(8).toString('hex')}.json`;
  const tmpPath = join(dir, tmpName);
  await writeFile(tmpPath, JSON.stringify(envelope, null, 2), 'utf-8');
  await rename(tmpPath, finalPath);
  await pruneOldestIfNeeded(profileDir, options?.maxSnapshots ?? DEFAULT_REFINEMENT_HISTORY_MAX);
}

export async function listRefinementSnapshots(
  profileDir: string,
): Promise<{ entries: RefinementHistoryListEntry[]; warnings: string[] }> {
  const dir = refinedHistoryDir(profileDir);
  const entries: RefinementHistoryListEntry[] = [];
  const warnings: string[] = [];
  if (!(await fileExists(dir))) return { entries, warnings };
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
  for (const name of names) {
    const path = join(dir, name);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RefinementSnapshotEnvelope>;
      if (
        parsed.schemaVersion !== REFINEMENT_HISTORY_SCHEMA_VERSION ||
        typeof parsed.id !== 'string' ||
        typeof parsed.savedAt !== 'string' ||
        typeof parsed.reason !== 'string' ||
        !parsed.data
      ) {
        warnings.push(`Skipping invalid snapshot file: ${name}`);
        continue;
      }
      entries.push({
        id: parsed.id,
        savedAt: parsed.savedAt,
        reason: parsed.reason as RefinementSaveReason,
        restoreSourceId: parsed.restoreSourceId,
      });
    } catch {
      warnings.push(`Skipping unreadable snapshot file: ${name}`);
    }
  }
  entries.sort((a, b) => {
    const na = Number.parseInt(a.id, 10);
    const nb = Number.parseInt(b.id, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na;
    return b.savedAt.localeCompare(a.savedAt);
  });
  return { entries, warnings };
}

function normalizeSnapshotId(idArg: string): string {
  const trimmed = idArg.trim();
  if (/^\d+$/.test(trimmed)) return String(Number.parseInt(trimmed, 10));
  return trimmed;
}

export async function loadRefinementSnapshotData(
  profileDir: string,
  idArg: string,
): Promise<RefinedData> {
  const id = normalizeSnapshotId(idArg);
  const path = snapshotFilePath(profileDir, id);
  if (!(await fileExists(path))) {
    throw new Error(
      `No refinement snapshot with id "${idArg}" under ${refinedHistoryDir(profileDir)}`,
    );
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    throw new Error(`Could not read snapshot "${idArg}": ${(e as Error).message}`);
  }
  let parsed: RefinementSnapshotEnvelope;
  try {
    parsed = JSON.parse(raw) as RefinementSnapshotEnvelope;
  } catch {
    throw new Error(`Snapshot "${idArg}" is not valid JSON — not restored.`);
  }
  if (
    parsed.schemaVersion !== REFINEMENT_HISTORY_SCHEMA_VERSION ||
    !parsed.data?.profile ||
    !parsed.data?.session
  ) {
    throw new Error(`Snapshot "${idArg}" is corrupt or incompatible — not restored.`);
  }
  return parsed.data;
}
