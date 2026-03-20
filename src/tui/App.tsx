import { Box, useApp, useInput } from 'ink';
import { useEffect, useMemo } from 'react';
import type { FlowOptions } from '../commands/flow.ts';
import { buildPendingCliArgs, screenRunsCliOnEnter } from './cliArgs.ts';
import { Layout } from './components/Layout.tsx';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.ts';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { DelegateScreen } from './screens/DelegateScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { useAppDispatch, useAppState } from './store.tsx';
import { SCREEN_ORDER, type TuiExitBag } from './types.ts';

/** Ink only sets `key.return` for `\r`; many TTYs send `\n` for Enter (`name === 'enter'`), which leaves `key.return` false. */
function isEnterKey(key: { return?: boolean }, input: string): boolean {
  return Boolean(key.return) || input === '\n' || input === '\r';
}

export interface AppProps {
  profileDir: string;
  flowOptions: FlowOptions;
  exitBag: TuiExitBag;
}

export function App({ profileDir, flowOptions, exitBag }: AppProps) {
  const { exit } = useApp();
  const snapshot = useProfileSnapshot(profileDir);
  const state = useAppState();
  const dispatch = useAppDispatch();

  const { activeScreen, focusTarget } = state;

  useEffect(() => {
    if (!snapshot.loading) {
      dispatch({ type: 'SET_HAS_REFINED', hasRefined: snapshot.hasRefined });
      dispatch({ type: 'SET_ERROR', error: snapshot.error });
    }
  }, [snapshot.loading, snapshot.hasRefined, snapshot.error, dispatch]);

  const footerHint = useMemo(() => {
    const base =
      '↑↓ change screen (anywhere) · Tab sidebar ↔ panel · 1–8 · d i r g j p c s · q quit';
    if (state.operationInProgress) {
      return `${base} · locked · Esc cancels op`;
    }
    if (state.inTextInput) {
      return 'Text field focused · q does not quit · Esc cancels field';
    }
    return focusTarget === 'sidebar' ? `${base} · Enter → panel` : base;
  }, [focusTarget, state.inTextInput, state.operationInProgress]);

  const panelFocusBanner = useMemo(() => {
    if (focusTarget !== 'content') {
      return null;
    }
    if (screenRunsCliOnEnter(activeScreen)) {
      return 'Enter → run this command in the terminal (you return here when it finishes). Esc → back to nav.';
    }
    return 'Enter does nothing on this screen. Esc or Tab → nav · ↑↓ still change screen.';
  }, [activeScreen, focusTarget]);

  useInput(
    (input, key) => {
      if (state.inTextInput) {
        return;
      }

      if (state.operationInProgress) {
        if (key.escape) {
          dispatch({ type: 'CANCEL_OPERATION' });
        }
        return;
      }

      if (key.tab) {
        dispatch({
          type: 'SET_FOCUS',
          target: focusTarget === 'sidebar' ? 'content' : 'sidebar',
        });
        return;
      }

      if (key.escape) {
        if (focusTarget === 'content') {
          dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
        }
        return;
      }

      if (input === 'q' || input === 'Q') {
        exitBag.quit = true;
        exitBag.pending = null;
        exit();
        return;
      }

      if (key.upArrow) {
        if (!(focusTarget === 'content' && activeScreen === 'dashboard')) {
          dispatch({
            type: 'SET_SCREEN',
            screen:
              SCREEN_ORDER[
                (SCREEN_ORDER.indexOf(activeScreen) - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length
              ],
          });
        }
        return;
      }
      if (key.downArrow) {
        if (!(focusTarget === 'content' && activeScreen === 'dashboard')) {
          dispatch({
            type: 'SET_SCREEN',
            screen: SCREEN_ORDER[(SCREEN_ORDER.indexOf(activeScreen) + 1) % SCREEN_ORDER.length],
          });
        }
        return;
      }

      if (focusTarget === 'sidebar' && isEnterKey(key, input)) {
        dispatch({ type: 'SET_FOCUS', target: 'content' });
        return;
      }

      if (focusTarget === 'content' && isEnterKey(key, input)) {
        const args = buildPendingCliArgs(activeScreen, profileDir, flowOptions);
        if (args) {
          exitBag.pending = args;
          exitBag.quit = false;
          exit();
        }
        return;
      }

      if (input >= '1' && input <= '8') {
        const idx = parseInt(input, 10) - 1;
        const next = SCREEN_ORDER[idx];
        if (next && next !== activeScreen) {
          dispatch({ type: 'SET_SCREEN', screen: next });
        }
        return;
      }

      const letterMap: Record<string, (typeof SCREEN_ORDER)[number]> = {
        d: 'dashboard',
        i: 'import',
        r: 'refine',
        g: 'generate',
        j: 'jobs',
        p: 'profile',
        c: 'contact',
        s: 'settings',
      };
      const mapped = letterMap[input];
      if (mapped && mapped !== activeScreen) {
        dispatch({ type: 'SET_SCREEN', screen: mapped });
      }
    },
    { isActive: true },
  );

  const content = (() => {
    switch (activeScreen) {
      case 'dashboard':
        return <DashboardScreen snapshot={snapshot} profileDir={profileDir} />;
      case 'import':
        return <ImportScreen profileDir={profileDir} />;
      case 'refine':
        return (
          <DelegateScreen
            title="Refine profile"
            description="Interactive Q&A and refinement (Claude). Uses the same flow as `suited refine`."
            cliHint="suited refine --profile-dir <dir>"
          />
        );
      case 'generate':
        return (
          <DelegateScreen
            title="Generate resume"
            description="Job description, templates, PDF export — same as `suited generate`."
            cliHint="suited generate --profile-dir <dir>"
          />
        );
      case 'jobs':
        return <JobsScreen profileDir={profileDir} />;
      case 'profile':
        return (
          <DelegateScreen
            title="Improve profile"
            description="Health checks, editing, and markdown tools via `suited improve`."
            cliHint="suited improve --profile-dir <dir>"
          />
        );
      case 'contact':
        return (
          <DelegateScreen
            title="Contact info"
            description="View and edit contact fields."
            cliHint="suited contact --profile-dir <dir>"
          />
        );
      case 'settings':
        return <SettingsScreen profileDir={profileDir} />;
      default: {
        const _n: never = activeScreen;
        return _n;
      }
    }
  })();

  return (
    <Box flexDirection="column">
      <Layout
        activeScreen={activeScreen}
        focusTarget={focusTarget}
        footerHint={footerHint}
        panelFocusBanner={panelFocusBanner}
        name={snapshot.name}
        positionCount={snapshot.positionCount}
        skillCount={snapshot.skillCount}
        hasRefined={snapshot.hasRefined}
        hasSource={snapshot.hasSource}
      >
        {content}
      </Layout>
    </Box>
  );
}
