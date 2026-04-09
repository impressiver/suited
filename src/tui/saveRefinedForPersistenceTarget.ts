import type { Profile, RefinedData } from '../profile/schema.ts';
import type { SaveRefinedOptions } from '../profile/serializer.ts';
import { saveJobRefinedProfile, saveRefined } from '../profile/serializer.ts';
import type { PersistenceTarget } from './activeDocumentSession.ts';

/**
 * Routes refined profile persistence by `persistenceTarget`.
 * Job target writes **profile only** via `saveJobRefinedProfile` (no global `RefinedData` / session file).
 */
export async function saveRefinedForPersistenceTarget(
  target: PersistenceTarget,
  args: {
    profile: Profile;
    session: RefinedData['session'];
    profileDir: string;
  },
  options?: SaveRefinedOptions,
): Promise<void> {
  if (target.kind === 'global-refined') {
    await saveRefined({ profile: args.profile, session: args.session }, args.profileDir, options);
    return;
  }
  await saveJobRefinedProfile(args.profile, args.profileDir, target.slug);
}
