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
    expect(s.operationCancelSeq).toBe(0);
    s = appReducer(s, { type: 'CANCEL_OPERATION' });
    expect(s.operationInProgress).toBe(false);
    expect(s.operationCancelSeq).toBe(1);
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

  it('tracks profile editor dirty flag', () => {
    let s = appReducer(base, { type: 'SET_PROFILE_EDITOR_DIRTY', value: true });
    expect(s.profileEditorDirty).toBe(true);
    s = appReducer(s, { type: 'SET_PROFILE_EDITOR_DIRTY', value: false });
    expect(s.profileEditorDirty).toBe(false);
  });

  it('sets profile editor return screen and clears when leaving profile', () => {
    let s = appReducer(base, { type: 'SET_PROFILE_EDITOR_RETURN_TO', screen: 'refine' });
    expect(s.profileEditorReturnTo).toBe('refine');
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'profile' });
    expect(s.profileEditorReturnTo).toBe('refine');
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'refine' });
    expect(s.profileEditorReturnTo).toBe(null);
  });
});
