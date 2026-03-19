import { Box, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { FlowOptions } from '../commands/flow.js';
import { buildPendingCliArgs, screenRunsCliOnEnter } from './cliArgs.js';
import { Layout } from './components/Layout.js';
import { useProfileSnapshot } from './hooks/useProfileSnapshot.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { DelegateScreen } from './screens/DelegateScreen.js';
import { ImportScreen } from './screens/ImportScreen.js';
import { JobsScreen } from './screens/JobsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { type FocusTarget, SCREEN_ORDER, type ScreenId, type TuiExitBag } from './types.js';

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
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard');
  const [focusTarget, setFocusTarget] = useState<FocusTarget>('sidebar');

  const footerHint = useMemo(() => {
    const base =
      '↑↓ change screen (anywhere) · Tab sidebar ↔ panel · 1–8 · d i r g j p c s · q quit';
    return focusTarget === 'sidebar' ? `${base} · Enter → panel` : base;
  }, [focusTarget]);

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
      if (key.tab) {
        setFocusTarget((f) => (f === 'sidebar' ? 'content' : 'sidebar'));
        return;
      }

      if (key.escape) {
        if (focusTarget === 'content') {
          setFocusTarget('sidebar');
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
        setActiveScreen((prev) => {
          const i = SCREEN_ORDER.indexOf(prev);
          return SCREEN_ORDER[(i - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length];
        });
        return;
      }
      if (key.downArrow) {
        setActiveScreen((prev) => {
          const i = SCREEN_ORDER.indexOf(prev);
          return SCREEN_ORDER[(i + 1) % SCREEN_ORDER.length];
        });
        return;
      }

      if (focusTarget === 'sidebar' && isEnterKey(key, input)) {
        setFocusTarget('content');
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
        if (next) {
          setActiveScreen(next);
        }
        return;
      }

      const letterMap: Record<string, ScreenId> = {
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
      if (mapped) {
        setActiveScreen(mapped);
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
