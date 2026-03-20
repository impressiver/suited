import { Box, useApp, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout.tsx';
import { ConfirmPrompt } from './components/shared/ConfirmPrompt.tsx';
import type { FlowOptions } from './flowOptions.ts';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.ts';
import { useTerminalSize } from './hooks/useTerminalSize.ts';
import { NavigateProvider } from './navigationContext.tsx';
import { PanelFooterHintProvider } from './panelFooterHintContext.tsx';
import { ContactScreen } from './screens/ContactScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { GenerateScreen } from './screens/GenerateScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { ProfileEditorScreen } from './screens/ProfileEditorScreen.tsx';
import { RefineScreen } from './screens/RefineScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { useAppDispatch, useAppState } from './store.tsx';
import { NAV_LABELS, SCREEN_ORDER, type ScreenId } from './types.ts';

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
  const [pendingNav, setPendingNav] = useState<ScreenId | null>(null);
  const [panelFooterHint, setPanelFooterHint] = useState<string | null>(null);

  const goToScreen = useCallback(
    (screen: ScreenId) => {
      if (state.profileEditorDirty && state.activeScreen === 'profile' && screen !== 'profile') {
        setPendingNav(screen);
        return;
      }
      dispatch({ type: 'SET_SCREEN', screen });
    },
    [dispatch, state.profileEditorDirty, state.activeScreen],
  );

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
    if (focusTarget === 'sidebar') {
      return `${base} · Enter → panel`;
    }
    if (panelFooterHint != null && panelFooterHint !== '') {
      return panelFooterHint;
    }
    return `${NAV_LABELS[activeScreen]} · Tab sidebar · 1–8 · letter keys · q quit`;
  }, [activeScreen, focusTarget, panelFooterHint, state.inTextInput, state.operationInProgress]);

  const panelFocusBanner = useMemo(() => {
    if (focusTarget !== 'content') {
      return null;
    }
    return 'Tab or Esc → return to sidebar · On Contact/Jobs/Generate/Refine/Profile, ↑↓ may move lists instead of changing screen';
  }, [focusTarget]);

  const screenUsesContentArrows = (screen: ScreenId): boolean =>
    screen === 'contact' ||
    screen === 'jobs' ||
    screen === 'generate' ||
    screen === 'refine' ||
    screen === 'profile';

  useInput(
    (input, key) => {
      if (pendingNav != null) {
        return;
      }

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
        if (focusTarget === 'content' && activeScreen === 'jobs') {
          return;
        }
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
          const next =
            SCREEN_ORDER[
              (SCREEN_ORDER.indexOf(activeScreen) - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length
            ];
          goToScreen(next);
        }
        return;
      }
      if (key.downArrow) {
        if (!(focusTarget === 'content' && screenUsesContentArrows(activeScreen))) {
          goToScreen(SCREEN_ORDER[(SCREEN_ORDER.indexOf(activeScreen) + 1) % SCREEN_ORDER.length]);
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
          goToScreen(next);
        }
        return;
      }

      const jobsDeferred = new Set(['a', 'd', 'g', 'p']);
      if (
        jobsDeferred.has(input.toLowerCase()) &&
        state.deferLetterShortcutsFor === 'jobs' &&
        activeScreen === 'jobs' &&
        focusTarget === 'content'
      ) {
        return;
      }

      /** Profile editor uses a/d on positions/bullets; do not steal `d`→dashboard. */
      const profileLetterDefer = new Set(['a', 'd']);
      if (
        profileLetterDefer.has(input.toLowerCase()) &&
        activeScreen === 'profile' &&
        focusTarget === 'content' &&
        !state.inTextInput
      ) {
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
        goToScreen(mapped);
      }
    },
    { isActive: pendingNav == null },
  );

  const content = (() => {
    switch (activeScreen) {
      case 'dashboard':
        return (
          <DashboardScreen
            snapshot={snapshot}
            profileDir={profileDir}
            onRefreshSnapshot={snapshot.refresh}
          />
        );
      case 'import':
        return (
          <ImportScreen
            profileDir={profileDir}
            headed={flowOptions.headed}
            clearSession={flowOptions.clearSession}
            onSourceChanged={snapshot.refresh}
          />
        );
      case 'refine':
        return <RefineScreen profileDir={profileDir} />;
      case 'generate':
        return <GenerateScreen profileDir={profileDir} />;
      case 'jobs':
        return <JobsScreen profileDir={profileDir} />;
      case 'profile':
        return <ProfileEditorScreen profileDir={profileDir} />;
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
    <NavigateProvider value={goToScreen}>
      <Box flexDirection="column" width={cols} height={rows}>
        {pendingNav != null && (
          <Box marginBottom={1} flexDirection="column">
            <ConfirmPrompt
              message="Profile has unsaved changes. Leave without saving?"
              active
              onConfirm={() => {
                dispatch({ type: 'SET_PROFILE_EDITOR_DIRTY', value: false });
                const target = pendingNav;
                setPendingNav(null);
                dispatch({ type: 'SET_SCREEN', screen: target });
              }}
              onCancel={() => setPendingNav(null)}
            />
          </Box>
        )}
        <PanelFooterHintProvider setHint={setPanelFooterHint}>
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
        </PanelFooterHintProvider>
      </Box>
    </NavigateProvider>
  );
}
