import { Box, Text } from 'ink';
import { hasApiKey } from '../env.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useAppState } from '../store.tsx';
import { SCREEN_ORDER } from '../types.ts';
import { ResumeEditor } from '../components/ResumeEditor.tsx';
import { ResumeEditorProvider } from '../components/ResumeEditorContext.tsx';

export interface DashboardScreenProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
  /** Re-load snapshot from disk (e.g. health retry). */
  onRefreshSnapshot?: () => void;
  /** Callback when selected section changes */
  onSectionChange?: (section: string | null) => void;
}

export function DashboardScreen({
  snapshot,
  profileDir,
  onRefreshSnapshot,
  onSectionChange,
}: DashboardScreenProps) {
  const { persistenceTarget } = useAppState();
  const navigate = useNavigateToScreen();
  const api = hasApiKey();

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {!api && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow" bold>
            ! API key or provider not configured.
          </Text>
          <Text dimColor>
            Open Settings ({SCREEN_ORDER.indexOf('settings') + 1}) or set ANTHROPIC_API_KEY /
            OPENROUTER_API_KEY in your environment.
          </Text>
        </Box>
      )}
      <ResumeEditorProvider
        value={{
          mode: 'general',
          persistenceTarget,
          onRequestClose: () => navigate('dashboard'),
        }}
      >
        <ResumeEditor
          snapshot={snapshot}
          profileDir={profileDir}
          onRefreshSnapshot={onRefreshSnapshot}
          onSectionChange={onSectionChange}
        />
      </ResumeEditorProvider>
    </Box>
  );
}
