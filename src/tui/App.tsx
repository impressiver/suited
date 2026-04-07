import { Box, useApp, useInput } from 'ink';
import type { Dispatch } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTopBarJobLine } from './activeDocumentSession.ts';
import { CommandPalette } from './components/CommandPalette.tsx';
import { ElegantShell } from './components/ElegantShell.tsx';
import { HelpDialog } from './components/HelpDialog.tsx';
import type { Notification } from './components/StatusBarNotifications.tsx';
import { ConfirmPrompt } from './components/shared/ConfirmPrompt.tsx';
import { shouldUseNoColor } from './env.ts';
import type { FlowOptions } from './flowOptions.ts';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.ts';
import { useTerminalSize } from './hooks/useTerminalSize.ts';
import { NavigateProvider } from './navigationContext.tsx';
import { NotificationProvider, useNotifications } from './notificationContext.tsx';
import { formatPipelineStrip } from './pipelineStrip.ts';
import { ContactScreen } from './screens/ContactScreen.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { EditorScreen } from './screens/EditorScreen.tsx';
import { GenerateScreen } from './screens/GenerateScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { JobsScreen } from './screens/JobsScreen.tsx';
import { ProfileEditorScreen } from './screens/ProfileEditorScreen.tsx';
import { RefineScreen } from './screens/RefineScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { type AppAction, getEffectiveScreen, useAppDispatch, useAppState } from './store.tsx';
import { isOverlayNavScreen, SCREEN_ORDER, type ScreenId } from './types.ts';
import { useValidation, ValidationProvider } from './validationContext.tsx';

export interface AppProps {
  profileDir: string;
  flowOptions: FlowOptions;
}

function dispatchScreenNavigation(
  dispatch: Dispatch<AppAction>,
  screen: ScreenId,
  activeScreen: ScreenId,
) {
  if (isOverlayNavScreen(screen) && (activeScreen === 'dashboard' || activeScreen === 'editor' || activeScreen === 'jobs')) {
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const { state: validationState } = useValidation();
  const { notifications } = useNotifications();

  const goToScreen = useCallback(
    (screen: ScreenId) => {
      if (state.profileEditorDirty && state.activeScreen === 'profile' && screen !== 'profile') {
        setPendingNav(screen);
        return;
      }
      if (
        state.editorDirty &&
        state.activeScreen === 'editor' &&
        screen !== state.activeScreen
      ) {
        setPendingNav(screen);
        return;
      }
      dispatchScreenNavigation(dispatch, screen, state.activeScreen);
    },
    [dispatch, state.profileEditorDirty, state.editorDirty, state.activeScreen],
  );

  const { overlayStack } = state;
  const effectiveScreen = useMemo(() => getEffectiveScreen(state), [state]);

  useEffect(() => {
    if (!snapshot.loading) {
      dispatch({ type: 'SET_HAS_REFINED', hasRefined: snapshot.hasRefined });
      dispatch({ type: 'SET_ERROR', error: snapshot.error });
    }
  }, [snapshot.loading, snapshot.hasRefined, snapshot.error, dispatch]);

  // Build combined status indicator (includes validation)
  const statusIndicator = useMemo(() => {
    // Priority: error > warning > ok
    if (state.lastError) {
      return { status: 'error' as const, label: 'Error', icon: '✗' };
    }
    if (validationState.error) {
      return { status: 'error' as const, label: 'Invalid', icon: '✗' };
    }
    if (state.operationInProgress) {
      return { status: 'neutral' as const, label: 'Working…', icon: '◐' };
    }
    if (validationState.valid === true) {
      return { status: 'ok' as const, label: 'Ready', icon: '✓' };
    }
    return null;
  }, [state.lastError, state.operationInProgress, validationState]);

  // Build pipeline indicator with colors
  const pipeline = useMemo(() => {
    return {
      hasSource: snapshot.hasSource,
      hasRefined: snapshot.hasRefined,
      hasJobs: snapshot.jobsCount > 0,
      hasPdf: Boolean(snapshot.lastPdfLine),
    };
  }, [snapshot.hasSource, snapshot.hasRefined, snapshot.jobsCount, snapshot.lastPdfLine]);

  // Build notifications array (up to 2)
  const currentNotifications = useMemo((): Notification[] => {
    const notes: Notification[] = [];

    // Priority: error > warning > info
    if (state.lastError) {
      notes.push({ id: 'error', message: state.lastError, type: 'error' });
    } else if (validationState.error) {
      notes.push({
        id: 'validation',
        message: `Validation: ${validationState.error}`,
        type: 'warn',
      });
    }

    // Add context notifications (up to 2 total)
    for (const ctxNotification of notifications.slice(0, 2)) {
      if (notes.length < 2) {
        notes.push({
          id: ctxNotification.id,
          message: ctxNotification.message,
          type: ctxNotification.type as 'info' | 'warn' | 'error' | 'success',
        });
      }
    }

    return notes;
  }, [state.lastError, validationState.error, notifications]);

  // Build context info for the title bar
  const contextInfo = useMemo(() => {
    if (state.operationInProgress) {
      return 'working…';
    }
    return null;
  }, [state.operationInProgress]);

  const jobLine = useMemo(
    () => formatTopBarJobLine(state.persistenceTarget),
    [state.persistenceTarget],
  );

  // Extract context target from persistence target (strip "Job: " prefix)
  const contextTarget = useMemo(() => {
    if (state.persistenceTarget.kind === 'job') {
      return state.persistenceTarget.slug;
    }
    return null;
  }, [state.persistenceTarget]);

  const screenUsesContentArrows = (screen: ScreenId): boolean =>
    screen === 'dashboard' ||
    screen === 'editor' ||
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
        if (effectiveScreen === 'editor' || effectiveScreen === 'jobs' || effectiveScreen === 'generate') {
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

      const profileLetterDefer = new Set(['a', 'd', 's']);
      if (
        profileLetterDefer.has(input.toLowerCase()) &&
        effectiveScreen === 'profile' &&
        !state.inTextInput
      ) {
        return;
      }

      if (effectiveScreen === 'contact' && !state.inTextInput && (input === 's' || input === 'S')) {
        return;
      }

      const letterMap: Record<string, ScreenId> = {
        d: 'dashboard',
        i: 'import',
        e: 'editor',
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
            onSectionChange={setSelectedSection}
          />
        );
      case 'editor':
        return (
          <EditorScreen
            snapshot={snapshot}
            profileDir={profileDir}
            onRefreshSnapshot={snapshot.refresh}
            onSectionChange={setSelectedSection}
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
          <HelpDialog
            width={cols}
            height={rows}
            onClose={() => setHelpOpen(false)}
            _currentScreen={effectiveScreen}
          />
        ) : (
          <>
            {/* Main content - always rendered */}
            <ElegantShell
              activeScreen={effectiveScreen}
              jobLine={jobLine}
              contextInfo={contextInfo}
              contextTarget={contextTarget}
              selectedSection={selectedSection}
              statusIndicator={statusIndicator}
              pipeline={pipeline}
              notifications={currentNotifications}
              width={cols}
              height={rows}
            >
              {content}
            </ElegantShell>

            {/* Overlays - rendered on top, don't affect layout height */}
            {pendingNav != null && (
              <Box position="absolute" marginTop={1} flexDirection="column" width={cols}>
                <ConfirmPrompt
                  message="Unsaved changes. Leave without saving?"
                  active
                  registerBlocking={false}
                  onConfirm={() => {
                    dispatch({ type: 'SET_PROFILE_EDITOR_DIRTY', value: false });
                    dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
                    const target = pendingNav;
                    setPendingNav(null);
                    dispatchScreenNavigation(dispatch, target, state.activeScreen);
                  }}
                  onCancel={() => setPendingNav(null)}
                />
              </Box>
            )}
            {state.paletteOpen && (
              <Box position="absolute" marginTop={1} width={cols}>
                <CommandPalette
                  active={state.paletteOpen}
                  onClose={() => dispatch({ type: 'SET_PALETTE_OPEN', open: false })}
                  onSelectScreen={(s) => goToScreen(s)}
                  onHelp={() => setHelpOpen(true)}
                  overlayDepth={overlayStack.length}
                  onClearOverlays={() => dispatch({ type: 'CLEAR_OVERLAYS' })}
                />
              </Box>
            )}
          </>
        )}
      </Box>
    </NavigateProvider>
  );
}

export function AppWithProviders(props: AppProps) {
  return (
    <ValidationProvider>
      <NotificationProvider>
        <App {...props} />
      </NotificationProvider>
    </ValidationProvider>
  );
}
