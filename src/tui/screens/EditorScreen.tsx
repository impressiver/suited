import { Box, Text } from 'ink';
import { useCallback, useMemo } from 'react';
import { globalRefinedTarget } from '../activeDocumentSession.ts';
import { ResumeEditor } from '../components/ResumeEditor.tsx';
import { type ResumeEditorContextValue, ResumeEditorProvider } from '../components/ResumeEditorContext.tsx';
import { hasApiKey } from '../env.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { SCREEN_ORDER } from '../types.ts';

export interface EditorScreenProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
  onRefreshSnapshot?: () => void;
  onSectionChange?: (section: string | null) => void;
}

export function EditorScreen({
  snapshot,
  profileDir,
  onRefreshSnapshot,
  onSectionChange,
}: EditorScreenProps) {
  const navigate = useNavigateToScreen();
  const api = hasApiKey();
  const onRequestClose = useCallback(() => navigate('dashboard'), [navigate]);
  const editorContext = useMemo((): ResumeEditorContextValue => ({
    mode: 'general',
    persistenceTarget: globalRefinedTarget(),
    onRequestClose,
  }), [onRequestClose]);

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
      <ResumeEditorProvider value={editorContext}>
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
