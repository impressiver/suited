import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearLinkedInSession } from '../../ingestion/linkedin-scraper.ts';
import { importProfileFromInput } from '../../services/importProfile.ts';
import { missingContactDetailPromptLabels } from '../../utils/contact.ts';
import { MultilineInput, SelectList, Spinner, TextInput } from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { isUserAbort } from '../isUserAbort.ts';
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
  const { createController, releaseController } = useOperationAbort();
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'line' | 'paste'>('line');
  const [headed, setHeaded] = useState(Boolean(headedOpt));
  const [lineValue, setLineValue] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [detectedKind, setDetectedKind] = useState<string | null>(null);
  const [apiFailureStreak, setApiFailureStreak] = useState(0);
  const [errMenuIdx, setErrMenuIdx] = useState(0);
  const [doneContactGap, setDoneContactGap] = useState<string | null>(null);
  const lastRawInputRef = useRef('');

  useEffect(() => {
    if (clearSession) {
      void clearLinkedInSession();
    }
  }, [clearSession]);

  const active = activeScreen === 'import' && focusTarget === 'content';

  const runImport = useCallback(
    async (raw: string) => {
      const input = raw.trim();
      if (!input) {
        setErr('Enter a LinkedIn URL, export ZIP path, directory, or pasted profile text.');
        setPhase('error');
        return;
      }
      lastRawInputRef.current = raw;
      setErr(null);
      setDoneContactGap(null);
      setPhase('running');
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      const ac = createController();
      try {
        const { detected, profile } = await importProfileFromInput({
          input,
          profileDir,
          headed,
          signal: ac.signal,
        });
        setDetectedKind(detected.kind);
        const stats = [
          `${profile.positions.length} positions`,
          `${profile.skills.length} skills`,
          `${profile.education.length} education`,
        ].join(' · ');
        setSummary(`${profile.contact.name.value} — ${stats}`);
        const gaps = missingContactDetailPromptLabels(profile);
        setDoneContactGap(gaps.length > 0 ? gaps.join(', ') : null);
        setApiFailureStreak(0);
        setPhase('done');
      } catch (e) {
        if (isUserAbort(e)) {
          setPhase('idle');
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setErr((e as Error).message);
        setPhase('error');
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, headed, profileDir, releaseController],
  );

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

  const showSettings = apiFailureStreak >= 3 && phase === 'error';

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
      {phase === 'error' && err != null && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">
            Import failed
          </Text>
          <Text color="red">{err}</Text>
          {showSettings && (
            <Box marginTop={1}>
              <Text dimColor>
                Several failures in a row — check API key / network in Settings if Claude parsing
                fails.
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <SelectList
              items={[
                { value: 'retry', label: 'Retry' },
                ...(showSettings
                  ? [{ value: 'settings', label: 'Check Settings (API key / provider)' }]
                  : []),
                { value: 'dismiss', label: 'Dismiss — edit input and try again' },
              ]}
              selectedIndex={errMenuIdx}
              onChange={(i) => setErrMenuIdx(i)}
              isActive={active}
              onSubmit={(item) => {
                if (item.value === 'settings') {
                  setApiFailureStreak(0);
                  dispatch({ type: 'SET_SCREEN', screen: 'settings' });
                  dispatch({ type: 'SET_FOCUS', target: 'content' });
                  setPhase('idle');
                  setErr(null);
                  return;
                }
                if (item.value === 'dismiss') {
                  setApiFailureStreak(0);
                  setPhase('idle');
                  setErr(null);
                  return;
                }
                setErrMenuIdx(0);
                void runImport(lastRawInputRef.current);
              }}
            />
          </Box>
        </Box>
      )}
      {phase === 'done' && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green">Saved source profile and markdown under {profileDir}</Text>
          {doneContactGap != null && (
            <Box marginTop={1}>
              <Text color="yellow">
                Missing contact: {doneContactGap}. Open Contact (c from Dashboard, or sidebar) to add
                these — same fields the CLI prompts after import.
              </Text>
            </Box>
          )}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {mode === 'line' ? (
          <>
            <Text dimColor>Input:</Text>
            <TextInput
              value={lineValue}
              onChange={setLineValue}
              focus={active && mode === 'line' && phase !== 'error'}
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
              focus={active && mode === 'paste' && phase !== 'error'}
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
