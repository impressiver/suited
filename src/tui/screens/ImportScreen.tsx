import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearLinkedInSession } from '../../ingestion/linkedin-scraper.ts';
import type { Profile } from '../../profile/schema.ts';
import { loadSource, sourceJsonPath } from '../../profile/serializer.ts';
import { importProfileFromInput } from '../../services/importProfile.ts';
import { missingContactDetailPromptLabels } from '../../utils/contact.ts';
import { fileExists } from '../../utils/fs.ts';
import {
  MultilineInput,
  ScrollView,
  SelectList,
  Spinner,
  TextInput,
} from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { panelInnerWidth } from '../panelContentWidth.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';

export interface ImportScreenProps {
  profileDir: string;
  headed?: boolean;
  clearSession?: boolean;
  /** After a successful import, refresh global snapshot (header / dashboard). */
  onSourceChanged?: () => void;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

type SourcePreviewState =
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'err'; msg: string }
  | { status: 'ok'; lines: string[] };

const PREVIEW_SCROLL_ROWS = 8;

function buildSourcePreviewLines(profile: Profile): string[] {
  const lines: string[] = [];
  const name = profile.contact.name.value.trim() || '(no name)';
  const headline = profile.contact.headline?.value?.trim();
  lines.push(headline ? `${name} — ${headline}` : name);
  const extras: string[] = [];
  if (profile.certifications.length > 0) {
    extras.push(`${profile.certifications.length} certs`);
  }
  if (profile.projects.length > 0) {
    extras.push(`${profile.projects.length} projects`);
  }
  const extraSuffix = extras.length > 0 ? ` · ${extras.join(' · ')}` : '';
  lines.push(
    `${profile.positions.length} positions · ${profile.skills.length} skills · ${profile.education.length} education${extraSuffix}`,
  );
  const cap = 5;
  for (const p of profile.positions.slice(0, cap)) {
    lines.push(`  · ${p.title.value} @ ${p.company.value}`);
  }
  if (profile.positions.length > cap) {
    lines.push(`  · … +${profile.positions.length - cap} more roles`);
  }
  const sum = profile.summary?.value?.replace(/\s+/g, ' ').trim();
  if (sum) {
    lines.push(sum.length > 140 ? `${sum.slice(0, 137)}…` : sum);
  }
  return lines;
}

export function ImportScreen({
  profileDir,
  headed: headedOpt,
  clearSession,
  onSourceChanged,
}: ImportScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const [termCols] = useTerminalSize();
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
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState>({ status: 'loading' });

  const reloadSourcePreview = useCallback(async () => {
    setSourcePreview({ status: 'loading' });
    try {
      if (!(await fileExists(sourceJsonPath(profileDir)))) {
        setSourcePreview({ status: 'absent' });
        return;
      }
      const profile = await loadSource(profileDir);
      setSourcePreview({ status: 'ok', lines: buildSourcePreviewLines(profile) });
    } catch (e) {
      setSourcePreview({ status: 'err', msg: (e as Error).message });
    }
  }, [profileDir]);

  useEffect(() => {
    void reloadSourcePreview();
  }, [reloadSourcePreview]);

  useEffect(() => {
    if (clearSession) {
      void clearLinkedInSession();
    }
  }, [clearSession]);

  const active = activeScreen === 'import' && focusTarget === 'content';

  const importFooterHint = useMemo(() => {
    const sb = ' · Tab sidebar';
    if (phase === 'running') {
      return `Import · importing…${sb}`;
    }
    if (phase === 'error') {
      return `Import · ↑↓ Enter · Esc sidebar · retry / settings / dismiss${sb}`;
    }
    const modeHint =
      mode === 'line'
        ? 'Enter submit · Esc sidebar · h headed browser toggle · p paste mode'
        : 'Ctrl+D or Ctrl+S submit · Esc sidebar · h headed toggle · p single-line mode';
    return `Import · ${modeHint}${sb}`;
  }, [mode, phase]);

  useRegisterPanelFooterHint(importFooterHint);

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
        void reloadSourcePreview();
        onSourceChanged?.();
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
    [
      createController,
      dispatch,
      headed,
      onSourceChanged,
      profileDir,
      releaseController,
      reloadSourcePreview,
    ],
  );

  useInput(
    (_input, key) => {
      if (!active || phase === 'running') {
        return;
      }
      if (key.escape) {
        dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
      }
    },
    { isActive: active && phase !== 'running' },
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

  const showSettings = apiFailureStreak >= 3 && phase === 'error';

  const sourcePreviewBlock = (
    <Box marginTop={1} flexDirection="column">
      <Text bold>Current source (source.json)</Text>
      {sourcePreview.status === 'loading' && <Text dimColor>Loading…</Text>}
      {sourcePreview.status === 'absent' && (
        <Text dimColor>No profile on disk yet — import below to create source.json.</Text>
      )}
      {sourcePreview.status === 'err' && (
        <Text color="yellow">Could not load source: {sourcePreview.msg}</Text>
      )}
      {sourcePreview.status === 'ok' && (
        <Box marginTop={1} flexDirection="column">
          <ScrollView lines={sourcePreview.lines} height={PREVIEW_SCROLL_ROWS} />
        </Box>
      )}
    </Box>
  );

  if (phase === 'running') {
    return (
      <Box flexDirection="column">
        <Text bold>Import</Text>
        {sourcePreviewBlock}
        <Box marginTop={1}>
          <Spinner label="Importing profile…" />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Import</Text>
      {sourcePreviewBlock}
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
                  navigate('settings');
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
                Missing contact: {doneContactGap}. Open Contact (c from Dashboard, or sidebar) to
                add these — same fields the CLI prompts after import.
              </Text>
            </Box>
          )}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {mode === 'line' ? (
          <TextInput
            value={lineValue}
            onChange={setLineValue}
            focus={active && mode === 'line' && phase !== 'error'}
            placeholder="https://linkedin.com/in/… or path to .zip"
            onSubmit={(v) => {
              void runImport(v);
            }}
          />
        ) : (
          <MultilineInput
            value={pasteValue}
            onChange={setPasteValue}
            focus={active && mode === 'paste' && phase !== 'error'}
            width={panelInnerWidth(termCols)}
            onSubmit={(v) => {
              void runImport(v);
            }}
          />
        )}
      </Box>
    </Box>
  );
}
