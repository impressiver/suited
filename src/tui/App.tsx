import { Box, useApp, useInput } from 'ink';
import type { Dispatch } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTopBarJobLine } from './activeDocumentSession.ts';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Layout } from './components/Layout.tsx';
import { ShortcutHelpOverlay } from './components/ShortcutHelpOverlay.tsx';
import { ConfirmPrompt } from './components/shared/ConfirmPrompt.tsx';
import { shouldUseNoColor } from './env.ts';
import type { FlowOptions } from './flowOptions.ts';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.ts';
import { useTerminalSize } from './hooks/useTerminalSize.ts';
import { NavigateProvider } from './navigationContext.tsx';
import { PanelFooterHintProvider } from './panelFooterHintContext.tsx';
import { formatPipelineStrip } from './pipelineStrip.ts';
import { ContactScreen } from './screens/ContactScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { GenerateScreen } from './screens/GenerateScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { ProfileEditorScreen } from './screens/ProfileEditorScreen.tsx';
import { RefineScreen } from './screens/RefineScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { type AppAction, getEffectiveScreen, useAppDispatch, useAppState } from './store.tsx';
import { isOverlayNavScreen, NAV_LABELS, SCREEN_ORDER, type ScreenId } from './types.ts';

export interface AppProps {
  profileDir: string;
  flowOptions: FlowOptions;
}

function dispatchScreenNavigation(
  dispatch: Dispatch<AppAction>,
  screen: ScreenId,
  activeScreen: ScreenId,
) {
  if (isOverlayNavScreen(screen) && (activeScreen === 'dashboard' || activeScreen === 'jobs')) {
    dispatch({ type: 'PUSH_OVERLAY', screen });
  } else {
    dispatch({ type: 'SET_SCREEN', screen });
  }
}

export function App({ profileDir, flowOptions }: AppProps) {
  const { exit } = useApp();
  const [cols, rows] = useTerminalSize();
  const snapshot = useProfileSnapshot(profileDir);
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [pendingNav, setPendingNav] = useState<ScreenId | null>(null);
  const [panelFooterHint, setPanelFooterHint] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const goToScreen = useCallback(
    (screen: ScreenId) => {
      if (state.profileEditorDirty && state.activeScreen === 'profile' && screen !== 'profile') {
        setPendingNav(screen);
        return;
      }
      /**
       * Import / Contact / Settings / Generate use PUSH_OVERLAY when the underlay is Resume (`dashboard`)
       * or **Jobs** so Esc / pop returns there without losing the shell context. From **Refine** or **Profile**,
       * the same targets use SET_SCREEN (full switch) so we do not stack overlays on flows that are not
       * document-shell underlays yet.
       */
      dispatchScreenNavigation(dispatch, screen, state.activeScreen);
    },
    [dispatch, state.profileEditorDirty, state.activeScreen],
  );

  const { overlayStack } = state;
  const effectiveScreen = useMemo(() => getEffectiveScreen(state), [state]);

  useEffect(() => {
    if (!snapshot.loading) {
      dispatch({ type: 'SET_HAS_REFINED', hasRefined: snapshot.hasRefined });
      dispatch({ type: 'SET_ERROR', error: snapshot.error });
    }
  }, [snapshot.loading, snapshot.hasRefined, snapshot.error, dispatch]);

  const pipelineNoColor = shouldUseNoColor();
  const pipelineStrip = useMemo(
    () =>
      formatPipelineStrip(
        {
          hasSource: snapshot.hasSource,
          hasRefined: snapshot.hasRefined,
          jobsCount: snapshot.jobsCount,
          lastPdfLine: snapshot.lastPdfLine,
        },
        { noColor: pipelineNoColor },
      ),
    [
      snapshot.hasSource,
      snapshot.hasRefined,
      snapshot.jobsCount,
      snapshot.lastPdfLine,
      pipelineNoColor,
    ],
  );

  const contextualHint = useMemo(() => {
    const nScreens = SCREEN_ORDER.length;
    const base = `↑↓ screen (when list does not own arrows) · 1–${nScreens} · d i c j r g s · : palette`;
    if (state.operationInProgress) {
      return `${base} · Esc cancels op when supported`;
    }
    if (state.inTextInput) {
      const fieldNote = 'Text field · q does not quit · Esc cancels/back';
      if (panelFooterHint != null && panelFooterHint !== '') {
        return `${panelFooterHint} · ${fieldNote}`;
      }
      return fieldNote;
    }
    if (panelFooterHint != null && panelFooterHint !== '') {
      return panelFooterHint;
    }
    return `${NAV_LABELS[effectiveScreen]} · ${base}`;
  }, [effectiveScreen, panelFooterHint, state.inTextInput, state.operationInProgress]);

  const baselineHint = ': palette · ? or Ctrl+? help · q quit · Ctrl+C exit';

  const statusLeft = useMemo(() => {
    if (state.lastError != null && state.lastError !== '') {
      return state.lastError;
    }
    if (state.operationInProgress) {
      return 'Working…';
    }
    return null;
  }, [state.lastError, state.operationInProgress]);

  const jobLine = useMemo(
    () => formatTopBarJobLine(state.persistenceTarget),
    [state.persistenceTarget],
  );

  const screenUsesContentArrows = (screen: ScreenId): boolean =>
    screen === 'dashboard' ||
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

      if (input === ':') {
        dispatch({ type: 'SET_PALETTE_OPEN', open: true });
        return;
      }

      if (input === '?' || (key.ctrl && (input === '?' || input === '/'))) {
        setHelpOpen(true);
        return;
      }

      if (key.escape) {
        // Jobs / Generate own Esc for inner wizards even when shown as overlays (stack non-empty).
        if (effectiveScreen === 'jobs' || effectiveScreen === 'generate') {
          return;
        }
        if (overlayStack.length > 0) {
          dispatch({ type: 'POP_OVERLAY' });
          return;
        }
        if (effectiveScreen !== 'dashboard') {
          goToScreen('dashboard');
        }
        return;
      }

      if (input === 'q' || input === 'Q') {
        exit();
        return;
      }

      if (key.upArrow) {
        if (overlayStack.length > 0) {
          return;
        }
        if (!screenUsesContentArrows(effectiveScreen)) {
          const next =
            SCREEN_ORDER[
              (SCREEN_ORDER.indexOf(effectiveScreen) - 1 + SCREEN_ORDER.length) %
                SCREEN_ORDER.length
            ];
          goToScreen(next);
        }
        return;
      }
      if (key.downArrow) {
        if (overlayStack.length > 0) {
          return;
        }
        if (!screenUsesContentArrows(effectiveScreen)) {
          goToScreen(
            SCREEN_ORDER[(SCREEN_ORDER.indexOf(effectiveScreen) + 1) % SCREEN_ORDER.length],
          );
        }
        return;
      }

      const digit = parseInt(input, 10);
      if (digit >= 1 && digit <= SCREEN_ORDER.length) {
        const idx = digit - 1;
        const next = SCREEN_ORDER[idx];
        if (next && next !== effectiveScreen) {
          goToScreen(next);
        }
        return;
      }

      const jobsDeferred = new Set(['a', 'd', 'g', 'p']);
      if (
        jobsDeferred.has(input.toLowerCase()) &&
        state.deferLetterShortcutsFor === 'jobs' &&
        effectiveScreen === 'jobs'
      ) {
        return;
      }

      /** Profile editor: a/d lists, s save — do not steal global letter jumps (d→dashboard, s→settings). */
      const profileLetterDefer = new Set(['a', 'd', 's']);
      if (
        profileLetterDefer.has(input.toLowerCase()) &&
        effectiveScreen === 'profile' &&
        !state.inTextInput
      ) {
        return;
      }

      /** Contact browse: s save-all — do not steal s→settings. */
      if (effectiveScreen === 'contact' && !state.inTextInput && (input === 's' || input === 'S')) {
        return;
      }

      const letterMap: Record<string, ScreenId> = {
        d: 'dashboard',
        i: 'import',
        r: 'refine',
        g: 'generate',
        j: 'jobs',
        c: 'contact',
        s: 'settings',
      };
      const mapped = letterMap[input];
      if (mapped && mapped !== effectiveScreen) {
        goToScreen(mapped);
      }
    },
    {
      isActive: pendingNav == null && state.blockingUiDepth === 0 && !helpOpen,
    },
  );

  const content = (() => {
    switch (effectiveScreen) {
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
        const _n: never = effectiveScreen;
        return _n;
      }
    }
  })();

  return (
    <NavigateProvider value={goToScreen}>
      <Box flexDirection="column" width={cols} height={rows}>
        {helpOpen ? (
          <ShortcutHelpOverlay width={cols} height={rows} onClose={() => setHelpOpen(false)} />
        ) : (
          <>
            {pendingNav != null && (
              <Box marginBottom={1} flexDirection="column">
                <ConfirmPrompt
                  message="Profile has unsaved changes. Leave without saving?"
                  active
                  registerBlocking={false}
                  onConfirm={() => {
                    dispatch({ type: 'SET_PROFILE_EDITOR_DIRTY', value: false });
                    const target = pendingNav;
                    setPendingNav(null);
                    dispatchScreenNavigation(dispatch, target, state.activeScreen);
                  }}
                  onCancel={() => setPendingNav(null)}
                />
              </Box>
            )}
            <PanelFooterHintProvider setHint={setPanelFooterHint}>
              {state.paletteOpen && (
                <CommandPalette
                  active={state.paletteOpen}
                  onClose={() => dispatch({ type: 'SET_PALETTE_OPEN', open: false })}
                  onSelectScreen={(s) => goToScreen(s)}
                  onHelp={() => setHelpOpen(true)}
                  overlayDepth={overlayStack.length}
                  onClearOverlays={() => dispatch({ type: 'CLEAR_OVERLAYS' })}
                />
              )}
              <Layout
                activeScreen={effectiveScreen}
                jobLine={jobLine}
                statusLeft={statusLeft}
                statusLeftWarn={Boolean(state.lastError)}
                statusRight={pipelineStrip}
                baselineHint={baselineHint}
                contextualHint={contextualHint}
              >
                {content}
              </Layout>
            </PanelFooterHintProvider>
          </>
        )}
      </Box>
    </NavigateProvider>
  );
}
