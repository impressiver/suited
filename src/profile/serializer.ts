import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileExists } from '../utils/fs.ts';
import { isNoHistorySnapshotEnv } from '../utils/refinementHistoryEnv.ts';
import { getGlobalContactMetaPath, getGlobalLogoCachePath } from '../utils/suitedDirs.ts';
import { profileMarkdownContent } from './markdown.ts';
import {
  commitRefinementSnapshot,
  type RefinementSaveReason,
  refinedDataIdentityCanon,
} from './refinementHistory.ts';
import {
  type ContactMeta,
  type GenerationConfig,
  type JobRefinement,
  type Profile,
  ProfileSchema,
  type RefinedData,
  type SavedJob,
} from './schema.ts';

export type { RefinementSaveReason } from './refinementHistory.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if mdPath exists and has a newer mtime than jsonPath. */
export async function isMdNewerThanJson(mdPath: string, jsonPath: string): Promise<boolean> {
  try {
    const [mdStat, jsonStat] = await Promise.all([stat(mdPath), stat(jsonPath)]);
    return mdStat.mtimeMs > jsonStat.mtimeMs;
  } catch {
    return false;
  }
}

/** URL-safe slug from company + title, e.g. "Acme Corp" + "Sr Engineer" → "acme-corp-sr-engineer" */
export function makeJobSlug(company: string, title: string): string {
  return `${company}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function parseProfile(data: unknown): Profile {
  const result = ProfileSchema.safeParse(data);
  if (!result.success) throw new Error(`Invalid profile data: ${result.error.message}`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Source data (phase 1 output)
// ---------------------------------------------------------------------------

export function sourceJsonPath(profileDir: string): string {
  return join(profileDir, 'source.json');
}

export function sourceMdPath(profileDir: string): string {
  return join(profileDir, 'source.md');
}

export async function saveSource(profile: Profile, profileDir: string): Promise<void> {
  profile.updatedAt = new Date().toISOString();
  await writeJson(sourceJsonPath(profileDir), profile);
}

export async function loadSource(profileDir: string): Promise<Profile> {
  const path = sourceJsonPath(profileDir);
  if (!(await fileExists(path))) {
    throw new Error(`source.json not found in ${profileDir}. Run 'resume import' first.`);
  }
  return parseProfile(await readJson(path));
}

/** SHA-256 of the raw source.json bytes — used to detect whether source changed between phases. */
export async function hashSource(profileDir: string): Promise<string> {
  const raw = await readFile(sourceJsonPath(profileDir), 'utf-8');
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Refined data (phase 2 output)
// ---------------------------------------------------------------------------

export function refinedJsonPath(profileDir: string): string {
  return join(profileDir, 'refined.json');
}

export function refinedMdPath(profileDir: string): string {
  return join(profileDir, 'refined.md');
}

export interface SaveRefinedOptions {
  /** Why the refined profile is being written (refinement history §3.2). */
  reason?: RefinementSaveReason;
  /** When reason is manual-restore, the snapshot id being restored from (§5). */
  restoreSourceId?: string;
  maxHistorySnapshots?: number;
  /**
   * When true, do not append a `refined-history/` snapshot before overwriting (§4 exception).
   * Also set via CLI `--no-history-snapshot` or env `SUITED_NO_HISTORY_SNAPSHOT=1`.
   */
  skipHistorySnapshot?: boolean;
}

export async function saveRefined(
  data: RefinedData,
  profileDir: string,
  options?: SaveRefinedOptions,
): Promise<void> {
  const jsonPath = refinedJsonPath(profileDir);
  const mdPath = refinedMdPath(profileDir);
  const existing = await loadRefinedIfExists(profileDir);

  const nextUpdatedAt = new Date().toISOString();
  const pending: RefinedData = {
    profile: { ...data.profile, updatedAt: nextUpdatedAt },
    session: data.session,
  };
  const skipSnapshot = options?.skipHistorySnapshot === true || isNoHistorySnapshotEnv();

  if (existing) {
    if (refinedDataIdentityCanon(pending) === refinedDataIdentityCanon(existing)) {
      return;
    }
    if (!skipSnapshot) {
      await commitRefinementSnapshot(profileDir, existing, options?.reason ?? 'unspecified', {
        restoreSourceId: options?.restoreSourceId,
        maxSnapshots: options?.maxHistorySnapshots,
      });
    }
  }

  data.profile.updatedAt = nextUpdatedAt;

  await mkdir(dirname(jsonPath), { recursive: true });
  const jsonTmp = join(dirname(jsonPath), `.refined.json.tmp.${randomBytes(8).toString('hex')}`);
  await writeFile(jsonTmp, JSON.stringify(pending, null, 2), 'utf-8');
  await rename(jsonTmp, jsonPath);

  await mkdir(dirname(mdPath), { recursive: true });
  const mdTmp = join(dirname(mdPath), `.refined.md.tmp.${randomBytes(8).toString('hex')}`);
  await writeFile(mdTmp, profileMarkdownContent(pending.profile), 'utf-8');
  await rename(mdTmp, mdPath);
}

/** Load refined data when `refined.json` exists; otherwise `null` (no throw). */
export async function loadRefinedIfExists(profileDir: string): Promise<RefinedData | null> {
  const path = refinedJsonPath(profileDir);
  if (!(await fileExists(path))) return null;
  const raw = await readJson<{ profile: unknown; session: unknown }>(path);
  return {
    profile: parseProfile(raw.profile),
    session: raw.session as RefinedData['session'],
  };
}

export async function loadRefined(profileDir: string): Promise<RefinedData> {
  const data = await loadRefinedIfExists(profileDir);
  if (!data) {
    throw new Error(`refined.json not found in ${profileDir}. Run 'resume refine' first.`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Job-specific refined profiles — jobs/{slug}/refined.{json,md}
// ---------------------------------------------------------------------------

export function jobRefinedJsonPath(profileDir: string, slug: string): string {
  return join(profileDir, 'jobs', slug, 'refined.json');
}

export function jobRefinedMdPath(profileDir: string, slug: string): string {
  return join(profileDir, 'jobs', slug, 'refined.md');
}

/** Per-job cover letter draft (Markdown). See specs/cover-letter-pdf.md. */
export function coverLetterMdPath(profileDir: string, slug: string): string {
  return join(profileDir, 'jobs', slug, 'cover-letter.md');
}

export async function saveJobRefinedProfile(
  profile: Profile,
  profileDir: string,
  slug: string,
): Promise<void> {
  profile.updatedAt = new Date().toISOString();
  await writeJson(jobRefinedJsonPath(profileDir, slug), profile);
}

export async function loadJobRefinedProfile(
  profileDir: string,
  slug: string,
): Promise<Profile | null> {
  const path = jobRefinedJsonPath(profileDir, slug);
  if (!(await fileExists(path))) return null;
  return parseProfile(await readJson(path));
}

// ---------------------------------------------------------------------------
// Active profile — use refined if available, otherwise fall back to source
// ---------------------------------------------------------------------------

export async function loadActiveProfile(profileDir: string): Promise<Profile> {
  if (await fileExists(refinedJsonPath(profileDir))) {
    const data = await loadRefined(profileDir);
    return data.profile;
  }
  return loadSource(profileDir);
}

// ---------------------------------------------------------------------------
// Generation config (phase 3 output)
// ---------------------------------------------------------------------------

export function generationConfigPath(profileDir: string): string {
  return join(profileDir, 'generation.json');
}

export async function saveGenerationConfig(
  config: GenerationConfig,
  profileDir: string,
): Promise<void> {
  config.updatedAt = new Date().toISOString();
  await writeJson(generationConfigPath(profileDir), config);
}

export async function loadGenerationConfig(profileDir: string): Promise<GenerationConfig | null> {
  const path = generationConfigPath(profileDir);
  if (!(await fileExists(path))) return null;
  return readJson<GenerationConfig>(path);
}

// ---------------------------------------------------------------------------
// Saved job library
// ---------------------------------------------------------------------------

export function jobsJsonPath(profileDir: string): string {
  return join(profileDir, 'jobs.json');
}

export async function loadJobs(profileDir: string): Promise<SavedJob[]> {
  const path = jobsJsonPath(profileDir);
  if (!(await fileExists(path))) return [];
  return readJson<SavedJob[]>(path);
}

export async function loadSavedJobById(profileDir: string, id: string): Promise<SavedJob | null> {
  const jobs = await loadJobs(profileDir);
  return jobs.find((j) => j.id === id) ?? null;
}

export async function saveJob(job: SavedJob, profileDir: string): Promise<void> {
  const jobs = await loadJobs(profileDir);
  if (jobs.some((j) => j.textHash === job.textHash)) return; // already saved
  await writeJson(jobsJsonPath(profileDir), [...jobs, job]);
}

export async function deleteJob(id: string, profileDir: string): Promise<void> {
  const jobs = await loadJobs(profileDir);
  await writeJson(
    jobsJsonPath(profileDir),
    jobs.filter((j) => j.id !== id),
  );
}

// ---------------------------------------------------------------------------
// Contact metadata — global config (XDG); legacy under profileDir migrated on read/write
// ---------------------------------------------------------------------------

function legacyContactMetaPath(profileDir: string): string {
  return join(profileDir, 'contact.json');
}

function contactMetaHasValues(meta: ContactMeta): boolean {
  return Object.values(meta).some((v) => typeof v === 'string' && v.length > 0);
}

export async function loadContactMeta(profileDir: string): Promise<ContactMeta> {
  const globalPath = getGlobalContactMetaPath();
  let fromGlobal: ContactMeta = {};
  if (await fileExists(globalPath)) {
    try {
      fromGlobal = await readJson<ContactMeta>(globalPath);
    } catch {
      fromGlobal = {};
    }
  }
  if (contactMetaHasValues(fromGlobal)) return fromGlobal;

  const legacy = legacyContactMetaPath(profileDir);
  if (await fileExists(legacy)) {
    try {
      return await readJson<ContactMeta>(legacy);
    } catch {
      return {};
    }
  }
  return {};
}

export async function saveContactMeta(meta: ContactMeta, profileDir: string): Promise<void> {
  // Only store keys that have a value — omit undefined/empty
  const clean: ContactMeta = Object.fromEntries(
    Object.entries(meta).filter(([, v]) => typeof v === 'string' && (v as string).length > 0),
  ) as ContactMeta;
  await writeJson(getGlobalContactMetaPath(), clean);
  await unlink(legacyContactMetaPath(profileDir)).catch(() => {});
}

/**
 * Merge saved contact metadata into a profile, filling only fields that are
 * absent in the profile. LinkedIn-provided values always take precedence.
 */
export function mergeContactMeta(profile: Profile, meta: ContactMeta): Profile {
  const now = new Date().toISOString();
  const src = { kind: 'user-edit' as const, editedAt: now };
  const wrap = (v: string) => ({ value: v, source: src });

  const contact = { ...profile.contact };
  if (meta.headline && !contact.headline) contact.headline = wrap(meta.headline);
  if (meta.email && !contact.email) contact.email = wrap(meta.email);
  if (meta.phone && !contact.phone) contact.phone = wrap(meta.phone);
  if (meta.location && !contact.location) contact.location = wrap(meta.location);
  if (meta.linkedin && !contact.linkedin) contact.linkedin = wrap(meta.linkedin);
  if (meta.website && !contact.website) contact.website = wrap(meta.website);
  if (meta.github && !contact.github) contact.github = wrap(meta.github);

  return { ...profile, contact };
}

// ---------------------------------------------------------------------------
// Job refinements — per-job curation plans
// ---------------------------------------------------------------------------

export function jobRefinementPath(profileDir: string, jobId: string): string {
  return join(profileDir, 'refinements', `${jobId}.json`);
}

export async function loadJobRefinement(
  profileDir: string,
  jobId: string,
): Promise<JobRefinement | null> {
  const path = jobRefinementPath(profileDir, jobId);
  if (!(await fileExists(path))) return null;
  return readJson<JobRefinement>(path);
}

export async function saveJobRefinement(
  refinement: JobRefinement,
  profileDir: string,
): Promise<void> {
  await writeJson(jobRefinementPath(profileDir, refinement.jobId), refinement);
}

export async function deleteJobRefinement(jobId: string, profileDir: string): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  await unlink(jobRefinementPath(profileDir, jobId)).catch(() => {
    /* already absent */
  });
}

/** After a global refined restore, drop layout squeeze hints that may no longer match content (§5.1 refinement-history). */
export async function clearPinnedRenderForAllJobs(profileDir: string): Promise<void> {
  const jobs = await loadJobs(profileDir);
  for (const job of jobs) {
    const refinement = await loadJobRefinement(profileDir, job.id);
    if (!refinement?.pinnedRender) continue;
    await saveJobRefinement({ ...refinement, pinnedRender: undefined }, profileDir);
  }
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

export async function clearRefined(profileDir: string): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  for (const p of [refinedJsonPath(profileDir), refinedMdPath(profileDir)]) {
    await unlink(p).catch(() => {
      /* already absent */
    });
  }
}

export async function clearGenerationConfig(profileDir: string): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  await unlink(generationConfigPath(profileDir)).catch(() => {
    /* already absent */
  });
}

// ---------------------------------------------------------------------------
// Legacy helpers — used internally and by validate command
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Logo cache — global XDG cache; legacy under profileDir merged then removed
// ---------------------------------------------------------------------------

function legacyLogoCachePath(profileDir: string): string {
  return join(profileDir, 'logo-cache.json');
}

export async function loadLogoCache(profileDir: string): Promise<Record<string, string>> {
  const globalPath = getGlobalLogoCachePath();
  let globalCache: Record<string, string> = {};
  if (await fileExists(globalPath)) {
    try {
      globalCache = await readJson<Record<string, string>>(globalPath);
    } catch {
      globalCache = {};
    }
  }

  const legacyPath = legacyLogoCachePath(profileDir);
  let legacyCache: Record<string, string> = {};
  if (await fileExists(legacyPath)) {
    try {
      legacyCache = await readJson<Record<string, string>>(legacyPath);
    } catch {
      legacyCache = {};
    }
  }

  if (Object.keys(legacyCache).length === 0) return globalCache;

  const merged = { ...legacyCache, ...globalCache };
  await writeJson(globalPath, merged);
  await unlink(legacyPath).catch(() => {
    /* already gone */
  });
  return merged;
}

export async function saveLogoCache(
  cache: Record<string, string>,
  profileDir: string,
): Promise<void> {
  await writeJson(getGlobalLogoCachePath(), cache);
  await unlink(legacyLogoCachePath(profileDir)).catch(() => {});
}

// ---------------------------------------------------------------------------

export async function loadProfile(filePath: string): Promise<Profile> {
  return parseProfile(await readJson(filePath));
}

export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  profile.updatedAt = new Date().toISOString();
  await writeJson(filePath, profile);
}
