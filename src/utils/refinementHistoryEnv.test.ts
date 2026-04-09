import { afterEach, describe, expect, it } from 'vitest';
import { isNoHistorySnapshotEnv, withNoHistorySnapshotFlag } from './refinementHistoryEnv.ts';

describe('refinementHistoryEnv', () => {
  afterEach(() => {
    delete process.env.SUITED_NO_HISTORY_SNAPSHOT;
  });

  it('withNoHistorySnapshotFlag sets env only for the async callback', async () => {
    expect(isNoHistorySnapshotEnv()).toBe(false);
    await withNoHistorySnapshotFlag(true, async () => {
      expect(isNoHistorySnapshotEnv()).toBe(true);
    });
    expect(isNoHistorySnapshotEnv()).toBe(false);
  });

  it('withNoHistorySnapshotFlag(false) does not set env', async () => {
    await withNoHistorySnapshotFlag(false, async () => {
      expect(isNoHistorySnapshotEnv()).toBe(false);
    });
  });

  it('restores previous env when nested', async () => {
    process.env.SUITED_NO_HISTORY_SNAPSHOT = '0';
    await withNoHistorySnapshotFlag(true, async () => {
      expect(process.env.SUITED_NO_HISTORY_SNAPSHOT).toBe('1');
    });
    expect(process.env.SUITED_NO_HISTORY_SNAPSHOT).toBe('0');
    delete process.env.SUITED_NO_HISTORY_SNAPSHOT;
  });
});
