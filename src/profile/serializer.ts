import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { Profile, ProfileSchema, RefinedData, GenerationConfig, SavedJob } from './schema.js';
import { fileExists } from '../utils/fs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export async function saveRefined(data: RefinedData, profileDir: string): Promise<void> {
  data.profile.updatedAt = new Date().toISOString();
  await writeJson(refinedJsonPath(profileDir), data);
}

export async function loadRefined(profileDir: string): Promise<RefinedData> {
  const path = refinedJsonPath(profileDir);
  if (!(await fileExists(path))) {
    throw new Error(`refined.json not found in ${profileDir}. Run 'resume refine' first.`);
  }
  const raw = await readJson<{ profile: unknown; session: unknown }>(path);
  return {
    profile: parseProfile(raw.profile),
    session: raw.session as RefinedData['session'],
  };
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

export async function loadGenerationConfig(
  profileDir: string,
): Promise<GenerationConfig | null> {
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

export async function saveJob(job: SavedJob, profileDir: string): Promise<void> {
  const jobs = await loadJobs(profileDir);
  if (jobs.some(j => j.textHash === job.textHash)) return; // already saved
  await writeJson(jobsJsonPath(profileDir), [...jobs, job]);
}

export async function deleteJob(id: string, profileDir: string): Promise<void> {
  const jobs = await loadJobs(profileDir);
  await writeJson(jobsJsonPath(profileDir), jobs.filter(j => j.id !== id));
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

export async function clearRefined(profileDir: string): Promise<void> {
  const { unlink } = await import('fs/promises');
  for (const p of [refinedJsonPath(profileDir), refinedMdPath(profileDir)]) {
    await unlink(p).catch(() => {/* already absent */});
  }
}

export async function clearGenerationConfig(profileDir: string): Promise<void> {
  const { unlink } = await import('fs/promises');
  await unlink(generationConfigPath(profileDir)).catch(() => {/* already absent */});
}

// ---------------------------------------------------------------------------
// Legacy helpers — used internally and by validate command
// ---------------------------------------------------------------------------

export async function loadProfile(filePath: string): Promise<Profile> {
  return parseProfile(await readJson(filePath));
}

export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  profile.updatedAt = new Date().toISOString();
  await writeJson(filePath, profile);
}
