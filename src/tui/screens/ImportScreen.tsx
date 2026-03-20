import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { clearLinkedInSession } from '../../ingestion/linkedin-scraper.ts';
import { importProfileFromInput } from '../../services/importProfile.ts';
import { MultilineInput, Spinner, TextInput } from '../components/shared/index.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

export interface ImportScreenProps {
  profileDir: string;
  headed?: boolean;
  clearSession?: boolean;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

export function ImportScreen({ profileDir, headed: headedOpt, clearSession }: ImportScreenProps) {
  const dispatch = useAppDispatch();
  const { focusTarget, activeScreen, inTextInput } = useAppState();
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'line' | 'paste'>('line');
  const [headed, setHeaded] = useState(Boolean(headedOpt));
  const [lineValue, setLineValue] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [detectedKind, setDetectedKind] = useState<string | null>(null);

  useEffect(() => {
    if (clearSession) {
      void clearLinkedInSession();
    }
  }, [clearSession]);

  const active = activeScreen === 'import' && focusTarget === 'content';

  const runImport = async (raw: string) => {
    const input = raw.trim();
    if (!input) {
      setErr('Enter a LinkedIn URL, export ZIP path, directory, or pasted profile text.');
      return;
    }
    setErr(null);
    setPhase('running');
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const { detected, profile } = await importProfileFromInput({
        input,
        profileDir,
        headed,
      });
      setDetectedKind(detected.kind);
      const stats = [
        `${profile.positions.length} positions`,
        `${profile.skills.length} skills`,
        `${profile.education.length} education`,
      ].join(' · ');
      setSummary(`${profile.contact.name.value} — ${stats}`);
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  };

  useInput(
    (input, _key) => {
      if (!active || phase === 'running' || inTextInput) {
        return;
      }
      if (input === 'h' || input === 'H') {
        setHeaded((v) => !v);
      }
      if (input === 'p' || input === 'P') {
        setMode((m) => (m === 'line' ? 'paste' : 'line'));
      }
    },
    { isActive: active && phase !== 'running' },
  );

  if (phase === 'running') {
    return (
      <Box flexDirection="column">
        <Text bold>Import</Text>
        <Spinner label="Importing profile…" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Import</Text>
      <Text dimColor>
        LinkedIn URL, export ZIP path, export directory, or profile text · h headed browser (
        {headed ? 'on' : 'off'}) · p {mode === 'line' ? 'paste mode' : 'single-line mode'}
      </Text>
      {detectedKind != null && phase === 'done' && (
        <Text dimColor>
          Detected: {detectedKind} · {summary}
        </Text>
      )}
      {err != null && <Text color="red">{err}</Text>}
      {phase === 'done' && (
        <Box marginTop={1}>
          <Text color="green">Saved source profile and markdown under {profileDir}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {mode === 'line' ? (
          <>
            <Text dimColor>Input:</Text>
            <TextInput
              value={lineValue}
              onChange={setLineValue}
              focus={active && mode === 'line'}
              placeholder="https://linkedin.com/in/… or path to .zip"
              onSubmit={(v) => {
                void runImport(v);
              }}
            />
          </>
        ) : (
          <>
            <Text dimColor>Paste profile text · Ctrl+D when done</Text>
            <MultilineInput
              value={pasteValue}
              onChange={setPasteValue}
              focus={active && mode === 'paste'}
              onSubmit={(v) => {
                void runImport(v);
              }}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
