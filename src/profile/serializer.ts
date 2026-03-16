import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Profile, ProfileSchema } from './schema.js';

export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  profile.updatedAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

export async function loadProfile(filePath: string): Promise<Profile> {
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const result = ProfileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid profile.json: ${result.error.message}`);
  }
  return result.data;
}
