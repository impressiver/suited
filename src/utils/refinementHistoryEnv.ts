const ENV_KEY = 'SUITED_NO_HISTORY_SNAPSHOT';

/** True when refined saves should skip `refined-history/` snapshots (CLI flag or env). */
export function isNoHistorySnapshotEnv(): boolean {
  return process.env[ENV_KEY] === '1';
}

/**
 * Sets `SUITED_NO_HISTORY_SNAPSHOT=1` for the duration of `fn` (restores previous env after).
 * Used by CLI `--no-history-snapshot` so all `saveRefined` paths honor it without threading options everywhere.
 */
export async function withNoHistorySnapshotFlag<T>(
  enabled: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  const prev = process.env[ENV_KEY];
  process.env[ENV_KEY] = '1';
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = prev;
    }
  }
}
