import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlairLevel, SavedJob } from '../../profile/schema.ts';
import { loadJobs } from '../../profile/serializer.ts';
import { runTuiGeneratePdf } from '../../services/generateResume.ts';
import { ProgressSteps, SelectList, Spinner } from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';

type Phase =
  | { p: 'pick-source' }
  | { p: 'pick-saved'; jobs: SavedJob[]; idx: number }
  | {
      p: 'pick-flair';
      jd?: string;
      jobId?: string;
      title: string;
      company: string;
      idx: number;
    }
  | { p: 'run' }
  | { p: 'done'; path: string }
  | { p: 'err'; msg: string; kind: 'preflight' | 'generate' };

type PickFlairSnapshot = {
  jd?: string;
  jobId?: string;
  title: string;
  company: string;
  idx: number;
};

type GenerateRunCtx = PickFlairSnapshot & { flair: FlairLevel };

const JOB_PROGRESS_LABELS = [
  'Job prep (analyze & curate)',
  'Build & polish resume',
  'Layout HTML & fit pages',
  'Export PDF',
  'Save metadata',
] as const;

const FULL_PROGRESS_LABELS = [
  'Build document',
  'Layout HTML & fit pages',
  'Export PDF',
  'Save metadata',
] as const;

const FLAIR_CHOICES: { flair: FlairLevel; label: string }[] = [
  { flair: 1, label: '1 — Classic (ATS-safe, serif)' },
  { flair: 2, label: '2 — Classic+ (minimal accents)' },
  { flair: 3, label: '3 — Modern (accent color)' },
  { flair: 4, label: '4 — Modern+ (bolder accents)' },
  { flair: 5, label: '5 — Bold (sidebar, color block)' },
];

export interface GenerateScreenProps {
  profileDir: string;
}

export function GenerateScreen({ profileDir }: GenerateScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { pendingJobId, activeScreen, focusTarget, inTextInput } = useAppState();
  const { createController, releaseController } = useOperationAbort();
  const [phase, setPhase] = useState<Phase>({ p: 'pick-source' });
  const [sourceIdx, setSourceIdx] = useState(0);
  const [apiFailureStreak, setApiFailureStreak] = useState(0);
  const [errMenuIdx, setErrMenuIdx] = useState(0);
  const [runStepIndex, setRunStepIndex] = useState(0);
  const [doneMenuIdx, setDoneMenuIdx] = useState(0);

  const recoverFlairRef = useRef<PickFlairSnapshot | null>(null);
  const lastGenCtxRef = useRef<GenerateRunCtx | null>(null);

  const active = activeScreen === 'generate' && focusTarget === 'content';

  const generateFooterHint = useMemo(() => {
    const sb = ' · Tab sidebar';
    switch (phase.p) {
      case 'pick-source':
        return `Generate · ↑↓ · Enter · saved job or full resume${sb}`;
      case 'pick-saved':
        return `Generate · ↑↓ · Enter choose job${sb}`;
      case 'pick-flair':
        return `Generate · ↑↓ flair · Enter run${sb}`;
      case 'done':
        return `Generate · ↑↓ Enter next step · letter keys / sidebar still work${sb}`;
      case 'err':
        return phase.kind === 'preflight'
          ? `Generate · Enter back to source${sb}`
          : `Generate · ↑↓ Enter · retry / settings / back${sb}`;
      case 'run':
        return `Generate · running… · Esc cancels when supported${sb}`;
      default:
        return `Generate${sb}`;
    }
  }, [phase]);

  useRegisterPanelFooterHint(generateFooterHint);

  useInput(
    (_input, key) => {
      if (!active || !key.escape) {
        return;
      }
      if (inTextInput) {
        return;
      }
      if (phase.p === 'pick-source') {
        dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
        return;
      }
      if (phase.p === 'pick-saved') {
        setSourceIdx(0);
        setPhase({ p: 'pick-source' });
        return;
      }
      if (phase.p === 'pick-flair') {
        if (phase.jobId) {
          void loadJobs(profileDir).then((jobs) => {
            setPhase({ p: 'pick-saved', jobs, idx: 0 });
          });
          return;
        }
        setSourceIdx(0);
        setPhase({ p: 'pick-source' });
        return;
      }
      if (phase.p === 'done') {
        dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
        return;
      }
      if (phase.p === 'err' && phase.kind === 'preflight') {
        setSourceIdx(0);
        setPhase({ p: 'pick-source' });
        return;
      }
      if (phase.p === 'err') {
        setApiFailureStreak(0);
        const snap = recoverFlairRef.current;
        if (snap) {
          setPhase({ p: 'pick-flair', ...snap });
        } else {
          setPhase({ p: 'pick-source' });
        }
      }
    },
    { isActive: active },
  );

  useEffect(() => {
    const id = pendingJobId;
    if (!id) {
      return;
    }
    void (async () => {
      const jobs = await loadJobs(profileDir);
      const job = jobs.find((j) => j.id === id);
      dispatch({ type: 'SET_PENDING_JOB', jobId: null });
      if (job) {
        setPhase({
          p: 'pick-flair',
          jd: job.text,
          jobId: job.id,
          title: job.title,
          company: job.company,
          idx: 2,
        });
      }
    })();
  }, [pendingJobId, profileDir, dispatch]);

  const sourceItems = useMemo(
    () => [
      { value: 'saved', label: 'Use a saved job' },
      { value: 'full', label: 'Full resume (no job targeting)' },
    ],
    [],
  );

  const runGenerate = useCallback(
    async (ctx: GenerateRunCtx) => {
      recoverFlairRef.current = {
        jd: ctx.jd,
        jobId: ctx.jobId,
        title: ctx.title,
        company: ctx.company,
        idx: ctx.idx,
      };
      lastGenCtxRef.current = ctx;
      setRunStepIndex(0);
      setPhase({ p: 'run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      const ac = createController();
      try {
        const { outputPath } = await runTuiGeneratePdf({
          profileDir,
          flair: ctx.flair,
          jd: ctx.jd,
          jobId: ctx.jobId,
          jobTitle: ctx.title,
          company: ctx.company,
          signal: ac.signal,
          onProgress: setRunStepIndex,
        });
        setApiFailureStreak(0);
        setDoneMenuIdx(0);
        setPhase({ p: 'done', path: outputPath });
      } catch (e) {
        if (isUserAbort(e)) {
          const snap = recoverFlairRef.current;
          if (snap) {
            setPhase({ p: 'pick-flair', ...snap });
          } else {
            setPhase({ p: 'pick-source' });
          }
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({ p: 'err', msg: (e as Error).message, kind: 'generate' });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, profileDir, releaseController],
  );

  if (phase.p === 'run') {
    const labels = lastGenCtxRef.current?.jd ? [...JOB_PROGRESS_LABELS] : [...FULL_PROGRESS_LABELS];
    const cap = Math.max(0, Math.min(runStepIndex, labels.length));
    return (
      <Box flexDirection="column">
        <Text bold>Generate</Text>
        <ProgressSteps steps={labels} currentIndex={cap} />
        <Box marginTop={1}>
          <Spinner label="Running pipeline…" />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'done') {
    return (
      <Box flexDirection="column">
        <Text bold color="green">
          PDF ready
        </Text>
        <Text>{phase.path}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Next</Text>
          <SelectList
            items={[
              { value: 'again', label: 'Regenerate with same options' },
              { value: 'flair', label: 'Change flair / job options' },
              { value: 'source', label: 'New source (saved job or full resume)' },
            ]}
            selectedIndex={doneMenuIdx}
            onChange={(i) => setDoneMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'again') {
                const ctx = lastGenCtxRef.current;
                if (ctx) {
                  void runGenerate(ctx);
                }
                return;
              }
              if (item.value === 'flair') {
                const snap = recoverFlairRef.current;
                if (snap) {
                  setPhase({ p: 'pick-flair', ...snap });
                } else {
                  setSourceIdx(0);
                  setPhase({ p: 'pick-source' });
                }
                return;
              }
              if (item.value === 'source') {
                setSourceIdx(0);
                setPhase({ p: 'pick-source' });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'err') {
    if (phase.kind === 'preflight') {
      return (
        <Box flexDirection="column">
          <Text bold color="red">
            Generate
          </Text>
          <Text color="red">{phase.msg}</Text>
          <Box marginTop={1}>
            <SelectList
              items={[{ value: 'back', label: 'Back to source options' }]}
              selectedIndex={0}
              onChange={() => {}}
              isActive={active}
              onSubmit={() => {
                setSourceIdx(0);
                setPhase({ p: 'pick-source' });
              }}
            />
          </Box>
        </Box>
      );
    }

    const showSettings = apiFailureStreak >= 3;
    return (
      <Box flexDirection="column">
        <Text bold color="red">
          Generate — error
        </Text>
        <Text color="red">{phase.msg}</Text>
        {showSettings && (
          <Box marginTop={1}>
            <Text dimColor>
              Several failures in a row — verify API key and provider in Settings.
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
              { value: 'back', label: 'Back to flair / job options' },
            ]}
            selectedIndex={errMenuIdx}
            onChange={(i) => setErrMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'settings') {
                setApiFailureStreak(0);
                navigate('settings');
                dispatch({ type: 'SET_FOCUS', target: 'content' });
                const snap = recoverFlairRef.current;
                if (snap) {
                  setPhase({ p: 'pick-flair', ...snap });
                } else {
                  setPhase({ p: 'pick-source' });
                }
                return;
              }
              if (item.value === 'back') {
                setApiFailureStreak(0);
                const snap = recoverFlairRef.current;
                if (snap) {
                  setPhase({ p: 'pick-flair', ...snap });
                } else {
                  setPhase({ p: 'pick-source' });
                }
                return;
              }
              setErrMenuIdx(0);
              const ctx = lastGenCtxRef.current;
              if (ctx) {
                void runGenerate(ctx);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'pick-flair') {
    const flairItems = FLAIR_CHOICES.map((c) => ({
      value: String(c.flair),
      label: c.label,
    }));
    return (
      <Box flexDirection="column">
        <Text bold>Generate</Text>
        {phase.jd ? (
          <Text>
            Job: {phase.title} @ {phase.company}
          </Text>
        ) : (
          <Text dimColor>Full resume (all profile content)</Text>
        )}
        <Box marginTop={1}>
          <SelectList
            items={flairItems}
            selectedIndex={phase.idx}
            onChange={(i) => setPhase({ ...phase, idx: i })}
            isActive={active}
            onSubmit={(item) => {
              const flair = parseInt(item.value, 10) as FlairLevel;
              void runGenerate({
                jd: phase.jd,
                jobId: phase.jobId,
                title: phase.title,
                company: phase.company,
                idx: phase.idx,
                flair,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'pick-saved') {
    const items = phase.jobs.map((j) => ({
      value: j.id,
      label: `${j.title} @ ${j.company}`,
    }));
    return (
      <Box flexDirection="column">
        <Text bold>Choose saved job</Text>
        <Box marginTop={1}>
          <SelectList
            items={items}
            selectedIndex={phase.idx}
            onChange={(i) => setPhase({ ...phase, idx: i })}
            isActive={active}
            onSubmit={(item) => {
              const j = phase.jobs.find((x) => x.id === item.value);
              if (!j) {
                return;
              }
              setPhase({
                p: 'pick-flair',
                jd: j.text,
                jobId: j.id,
                title: j.title,
                company: j.company,
                idx: 2,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Generate resume</Text>
      <Box marginTop={1}>
        <SelectList
          items={sourceItems}
          selectedIndex={sourceIdx}
          onChange={(i) => setSourceIdx(i)}
          isActive={active}
          onSubmit={async (item) => {
            if (item.value === 'saved') {
              const jobs = await loadJobs(profileDir);
              if (jobs.length === 0) {
                setPhase({
                  p: 'err',
                  msg: 'No saved jobs — add one from Jobs (j).',
                  kind: 'preflight',
                });
                return;
              }
              setPhase({ p: 'pick-saved', jobs, idx: 0 });
              return;
            }
            setPhase({
              p: 'pick-flair',
              title: 'Resume',
              company: '',
              idx: 2,
            });
          }}
        />
      </Box>
    </Box>
  );
}
