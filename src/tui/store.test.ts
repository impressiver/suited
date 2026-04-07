import { describe, expect, it } from 'vitest';
import { globalRefinedTarget, jobRefinedTarget } from './activeDocumentSession.ts';
import { appReducer, createInitialAppState } from './store.tsx';

describe('appReducer', () => {
  const base = createInitialAppState('/tmp/profile');

  it('sets screen and closes palette', () => {
    let s = appReducer(base, { type: 'SET_PALETTE_OPEN', open: true });
    expect(s.paletteOpen).toBe(true);
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'settings' });
    expect(s.activeScreen).toBe('settings');
    expect(s.paletteOpen).toBe(false);
  });

  it('SET_SCREEN clears overlay stack', () => {
    let s = appReducer(base, { type: 'PUSH_OVERLAY', screen: 'import' });
    s = appReducer(s, { type: 'PUSH_OVERLAY', screen: 'settings' });
    expect(s.overlayStack).toEqual(['import', 'settings']);
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'jobs' });
    expect(s.overlayStack).toEqual([]);
    expect(s.activeScreen).toBe('jobs');
  });

  it('PUSH_OVERLAY appends and closes palette; duplicate top is no-op push', () => {
    let s = appReducer(base, { type: 'SET_PALETTE_OPEN', open: true });
    s = appReducer(s, { type: 'PUSH_OVERLAY', screen: 'contact' });
    expect(s.overlayStack).toEqual(['contact']);
    expect(s.paletteOpen).toBe(false);
    s = appReducer(s, { type: 'PUSH_OVERLAY', screen: 'contact' });
    expect(s.overlayStack).toEqual(['contact']);
  });

  it('POP_OVERLAY pops one; POP on empty is no-op', () => {
    let s = appReducer(base, { type: 'PUSH_OVERLAY', screen: 'import' });
    s = appReducer(s, { type: 'PUSH_OVERLAY', screen: 'generate' });
    s = appReducer(s, { type: 'POP_OVERLAY' });
    expect(s.overlayStack).toEqual(['import']);
    s = appReducer(s, { type: 'POP_OVERLAY' });
    expect(s.overlayStack).toEqual([]);
    expect(appReducer(s, { type: 'POP_OVERLAY' })).toBe(s);
  });

  it('CLEAR_OVERLAYS empties stack', () => {
    let s = appReducer(base, { type: 'PUSH_OVERLAY', screen: 'settings' });
    s = appReducer(s, { type: 'CLEAR_OVERLAYS' });
    expect(s.overlayStack).toEqual([]);
  });

  it('sets persistence target', () => {
    const j = jobRefinedTarget('jid', 'acme');
    const s = appReducer(base, { type: 'SET_PERSISTENCE_TARGET', target: j });
    expect(s.persistenceTarget).toEqual(j);
  });

  it('SET_SCREEN to dashboard clears job persistence target', () => {
    let s = appReducer(base, {
      type: 'SET_PERSISTENCE_TARGET',
      target: jobRefinedTarget('jid', 'acme'),
    });
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'dashboard' });
    expect(s.persistenceTarget).toEqual(globalRefinedTarget());
    expect(s.activeScreen).toBe('dashboard');
  });

  it('SET_SCREEN to non-dashboard keeps job persistence target', () => {
    const j = jobRefinedTarget('jid', 'acme');
    let s = appReducer(base, { type: 'SET_PERSISTENCE_TARGET', target: j });
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'generate' });
    expect(s.persistenceTarget).toEqual(j);
  });

  it('defaults persistence to global refined', () => {
    expect(base.persistenceTarget).toEqual(globalRefinedTarget());
    expect(base.paletteOpen).toBe(false);
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

  it('increments and decrements blocking UI depth without going negative', () => {
    let s = appReducer(base, { type: 'INCREMENT_BLOCKING_UI' });
    expect(s.blockingUiDepth).toBe(1);
    s = appReducer(s, { type: 'INCREMENT_BLOCKING_UI' });
    expect(s.blockingUiDepth).toBe(2);
    s = appReducer(s, { type: 'DECREMENT_BLOCKING_UI' });
    expect(s.blockingUiDepth).toBe(1);
    s = appReducer(s, { type: 'DECREMENT_BLOCKING_UI' });
    expect(s.blockingUiDepth).toBe(0);
    s = appReducer(s, { type: 'DECREMENT_BLOCKING_UI' });
    expect(s.blockingUiDepth).toBe(0);
  });

  it('sets profile editor return screen and clears when leaving profile', () => {
    let s = appReducer(base, { type: 'SET_PROFILE_EDITOR_RETURN_TO', screen: 'editor' });
    expect(s.profileEditorReturnTo).toBe('editor');
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'profile' });
    expect(s.profileEditorReturnTo).toBe('editor');
    s = appReducer(s, { type: 'SET_SCREEN', screen: 'editor' });
    expect(s.profileEditorReturnTo).toBe(null);
  });
});
