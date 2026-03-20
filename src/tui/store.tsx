import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useMemo,
  useReducer,
} from 'react';
import type { Profile } from '../profile/schema.ts';
import type { FocusTarget, ScreenId } from './types.ts';

export interface AppState {
  profileDir: string;
  profile: Profile | null;
  hasRefined: boolean;
  activeScreen: ScreenId;
  /** Widen to arbitrary region strings when per-screen Tab stacks land (see architecture). */
  focusTarget: FocusTarget;
  inTextInput: boolean;
  operationInProgress: boolean;
  /** Incremented on `CANCEL_OPERATION` (Esc during a locked op) so screens can abort in-flight work. */
  operationCancelSeq: number;
  lastError: string | null;
  pendingJobId: string | null;
  /**
   * When set to the active screen, App defers `a`/`d`/`g`/`p` to that screen (Jobs per tui-screens.md).
   */
  deferLetterShortcutsFor: ScreenId | null;
}

export type AppAction =
  | { type: 'SET_SCREEN'; screen: ScreenId }
  | { type: 'SET_PROFILE'; profile: Profile; hasRefined: boolean }
  /** Snapshot-only sync until full profile is loaded into state (Phase B+). */
  | { type: 'SET_HAS_REFINED'; hasRefined: boolean }
  | { type: 'SET_FOCUS'; target: FocusTarget }
  | { type: 'SET_IN_TEXT_INPUT'; value: boolean }
  | { type: 'SET_OPERATION_IN_PROGRESS'; value: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_PENDING_JOB'; jobId: string | null }
  | { type: 'SET_DEFER_LETTER_SHORTCUTS'; screen: ScreenId | null }
  /** Clears async lock (Esc during `operationInProgress`); extend later for AbortSignal. */
  | { type: 'CANCEL_OPERATION' };

export function createInitialAppState(profileDir: string): AppState {
  return {
    profileDir,
    profile: null,
    hasRefined: false,
    activeScreen: 'dashboard',
    focusTarget: 'sidebar',
    inTextInput: false,
    operationInProgress: false,
    operationCancelSeq: 0,
    lastError: null,
    pendingJobId: null,
    deferLetterShortcutsFor: null,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, activeScreen: action.screen };
    case 'SET_PROFILE':
      return { ...state, profile: action.profile, hasRefined: action.hasRefined };
    case 'SET_HAS_REFINED':
      return { ...state, hasRefined: action.hasRefined };
    case 'SET_FOCUS':
      return { ...state, focusTarget: action.target };
    case 'SET_IN_TEXT_INPUT':
      return { ...state, inTextInput: action.value };
    case 'SET_OPERATION_IN_PROGRESS':
      return { ...state, operationInProgress: action.value };
    case 'SET_ERROR':
      return { ...state, lastError: action.error };
    case 'SET_PENDING_JOB':
      return { ...state, pendingJobId: action.jobId };
    case 'SET_DEFER_LETTER_SHORTCUTS':
      return { ...state, deferLetterShortcutsFor: action.screen };
    case 'CANCEL_OPERATION':
      return {
        ...state,
        operationInProgress: false,
        operationCancelSeq: state.operationCancelSeq + 1,
      };
  }
}

interface AppStoreValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({
  profileDir,
  children,
}: {
  profileDir: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(appReducer, profileDir, createInitialAppState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error('useAppStore must be used within AppStoreProvider');
  }
  return ctx;
}

export function useAppState(): AppState {
  return useAppStore().state;
}

export function useAppDispatch(): Dispatch<AppAction> {
  return useAppStore().dispatch;
}
