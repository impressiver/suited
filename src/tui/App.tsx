import { Box, useApp, useInput } from 'ink';
import { useEffect, useMemo } from 'react';
import type { FlowOptions } from '../commands/flow.ts';
import { Layout } from './components/Layout.tsx';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.ts';
import { useTerminalSize } from './hooks/useTerminalSize.ts';
import { ContactScreen } from './screens/ContactScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { GenerateScreen } from './screens/GenerateScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { ProfileEditorScreen } from './screens/ProfileEditorScreen.tsx';
import { RefineScreen } from './screens/RefineScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { useAppDispatch, useAppState } from './store.tsx';
import { SCREEN_ORDER, type ScreenId } from './types.ts';

/** Ink only sets `key.return` for `\r`; many TTYs send `\n` for Enter (`name === 'enter'`), which leaves `key.return` false. */
function isEnterKey(key: { return?: boolean }, input: string): boolean {
  return Boolean(key.return) || input === '\n' || input === '\r';
}

export interface AppProps {
  profileDir: string;
  flowOptions: FlowOptions;
}

export function App({ profileDir, flowOptions }: AppProps) {
  const { exit } = useApp();
  const [cols, rows] = useTerminalSize();
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
      '↑↓ change screen (most views) · Tab sidebar ↔ panel · 1–8 · d i c j r p g s · q quit';
    if (state.operationInProgress) {
      return `${base} · locked · Esc cancels op`;
    }
    if (state.inTextInput) {
      return 'Text field focused · q does not quit · Esc cancels field';
    }
    if (activeScreen === 'contact' && focusTarget === 'content') {
      return 'Contact · ↑↓ Tab field · Enter edit · s save all · Esc sidebar (from browse)';
    }
    return focusTarget === 'sidebar' ? `${base} · Enter → panel` : base;
  }, [activeScreen, focusTarget, state.inTextInput, state.operationInProgress]);

  const panelFocusBanner = useMemo(() => {
    if (focusTarget !== 'content') {
      return null;
    }
    return 'Tab or Esc → return to sidebar · On Dashboard/Contact, ↑↓ may move lists or fields instead of changing screen';
  }, [focusTarget]);

  const screenUsesContentArrows = (screen: ScreenId): boolean =>
    screen === 'dashboard' || screen === 'contact';

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
        if (activeScreen === 'contact' && focusTarget === 'content') {
          return;
        }
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
        exit();
        return;
      }

      if (key.upArrow) {
        if (!(focusTarget === 'content' && screenUsesContentArrows(activeScreen))) {
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
        if (!(focusTarget === 'content' && screenUsesContentArrows(activeScreen))) {
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
        return (
          <ImportScreen
            profileDir={profileDir}
            headed={flowOptions.headed}
            clearSession={flowOptions.clearSession}
          />
        );
      case 'refine':
        return <RefineScreen />;
      case 'generate':
        return <GenerateScreen />;
      case 'jobs':
        return <JobsScreen profileDir={profileDir} />;
      case 'profile':
        return <ProfileEditorScreen />;
      case 'contact':
        return <ContactScreen profileDir={profileDir} />;
      case 'settings':
        return <SettingsScreen profileDir={profileDir} />;
      default: {
        const _n: never = activeScreen;
        return _n;
      }
    }
  })();

  return (
    <Box flexDirection="column" width={cols} height={rows}>
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
