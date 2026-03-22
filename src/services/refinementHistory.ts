import {
  listRefinementSnapshots,
  loadRefinementSnapshotData,
} from '../profile/refinementHistory.ts';
import { clearPinnedRenderForAllJobs, saveRefined } from '../profile/serializer.ts';

export async function listGlobalRefinementHistory(profileDir: string) {
  return listRefinementSnapshots(profileDir);
}

export async function restoreGlobalRefinedSnapshot(
  profileDir: string,
  id: string,
  options?: { replaceHeadOnly?: boolean },
): Promise<void> {
  const data = await loadRefinementSnapshotData(profileDir, id);
  await clearPinnedRenderForAllJobs(profileDir);
  await saveRefined(data, profileDir, {
    reason: 'manual-restore',
    restoreSourceId: id,
    skipHistorySnapshot: options?.replaceHeadOnly === true,
  });
}
