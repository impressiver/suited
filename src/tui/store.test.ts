import { describe, expect, it } from 'vitest';
import { appReducer, createInitialAppState } from './store.tsx';

describe('appReducer', () => {
  const base = createInitialAppState('/tmp/profile');

  it('sets screen', () => {
    const s = appReducer(base, { type: 'SET_SCREEN', screen: 'settings' });
    expect(s.activeScreen).toBe('settings');
  });

  it('toggles operation lock and cancel', () => {
    let s = appReducer(base, { type: 'SET_OPERATION_IN_PROGRESS', value: true });
    expect(s.operationInProgress).toBe(true);
    s = appReducer(s, { type: 'CANCEL_OPERATION' });
    expect(s.operationInProgress).toBe(false);
  });

  it('sets text-input gate', () => {
    const s = appReducer(base, { type: 'SET_IN_TEXT_INPUT', value: true });
    expect(s.inTextInput).toBe(true);
  });

  it('sets pending job id', () => {
    const s = appReducer(base, { type: 'SET_PENDING_JOB', jobId: 'job-1' });
    expect(s.pendingJobId).toBe('job-1');
  });

  it('defers letter shortcuts for a screen', () => {
    const s = appReducer(base, {
      type: 'SET_DEFER_LETTER_SHORTCUTS',
      screen: 'jobs',
    });
    expect(s.deferLetterShortcutsFor).toBe('jobs');
  });
});
