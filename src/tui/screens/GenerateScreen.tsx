import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlairLevel, SavedJob, TemplateName } from '../../profile/schema.ts';
import { loadJobs, makeJobSlug } from '../../profile/serializer.ts';
import { readCoverLetterDraft } from '../../services/coverLetterPdf.ts';
import {
  runTuiGenerateBuildPhase,
  runTuiGenerateRenderPhase,
  type TuiGenerateBuiltState,
} from '../../services/generateResume.ts';
import {
  buildSectionCheckboxItems,
  collectDefaultSectionKeys,
  MIN_VISIBLE_RESUME_POSITIONS,
} from '../../services/sectionSelection.ts';
import { CheckboxList, ProgressSteps, SelectList, Spinner } from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { getEffectiveScreen, useAppDispatch, useAppState } from '../store.tsx';

type PickFlairSnapshot = {
  jd?: string;
  jobId?: string;
  title: string;
  company: string;
  idx: number;
};

type GenerateRunCtx = PickFlairSnapshot & {
  flair: FlairLevel;
  templateOverride?: TemplateName;
};

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
  | { p: 'building'; ctx: GenerateRunCtx }
  | { p: 'pick-sections'; ctx: GenerateRunCtx }
  | { p: 'run' }
  | { p: 'done'; path: string; coverLetterPath?: string }
  | { p: 'err'; msg: string; kind: 'preflight' | 'generate' };

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

const FLAIR_CHOICES: {
  value: string;
  flair: FlairLevel;
  templateOverride?: TemplateName;
  label: string;
}[] = [
  { value: '1', flair: 1, label: '1 — Classic (ATS-safe, serif)' },
  { value: '2', flair: 2, label: '2 — Classic+ (minimal accents)' },
  { value: '3', flair: 3, label: '3 — Modern (accent color)' },
  { value: '4', flair: 4, label: '4 — Modern+ (bolder accents)' },
  { value: '5', flair: 5, label: '5 — Bold (sidebar, color block)' },
  {
    value: 'retro',
    flair: 1,
    templateOverride: 'retro',
    label: '★ — Retro Terminal (amber-on-black, ASCII art)',
  },
  {
    value: 'timeline',
    flair: 4,
    templateOverride: 'timeline',
    label: '◈ — Timeline (dark header, prose entries, two-column)',
  },
];

export interface GenerateScreenProps {
  profileDir: string;
}

export function GenerateScreen({ profileDir }: GenerateScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const appState = useAppState();
  const { pendingJobId, focusTarget, inTextInput, overlayStack } = appState;
  const effectiveScreen = getEffectiveScreen(appState);
  const { createController, releaseController } = useOperationAbort();
  const [phase, setPhase] = useState<Phase>({ p: 'pick-source' });
  const [sourceIdx, setSourceIdx] = useState(0);
  const [apiFailureStreak, setApiFailureStreak] = useState(0);
  const [errMenuIdx, setErrMenuIdx] = useState(0);
  const [runStepIndex, setRunStepIndex] = useState(0);
  const [doneMenuIdx, setDoneMenuIdx] = useState(0);

  const recoverFlairRef = useRef<PickFlairSnapshot | null>(null);
  const lastGenCtxRef = useRef<GenerateRunCtx | null>(null);
  const builtForRenderRef = useRef<TuiGenerateBuiltState | null>(null);
  /** Last successful PDF section keys (restores checkboxes on regenerate). */
  const lastSectionSelectionRef = useRef<string[] | null>(null);
  /** Keys chosen before the latest render attempt (for retry after render-only failures). */
  const lastPickedSectionSelectionRef = useRef<string[] | null>(null);
  const [sectionItems, setSectionItems] = useState<
    Array<{ value: string; label: string; checked: boolean }>
  >([]);
  const [sectionFocusIdx, setSectionFocusIdx] = useState(0);
  const [coverLetterExportable, setCoverLetterExportable] = useState(false);

  const active = effectiveScreen === 'generate' && focusTarget === 'content';

  const leaveGenerateSurface = useCallback(() => {
    if (overlayStack.length > 0) {
      dispatch({ type: 'POP_OVERLAY' });
    } else {
      navigate('dashboard');
    }
  }, [dispatch, navigate, overlayStack.length]);

  useRegisterBlockingUi(active && phase.p === 'err');

  const generateFooterHint = useMemo(() => {
    const sb = ' · : palette';
    switch (phase.p) {
      case 'pick-source':
        return `Generate · ↑↓ · Enter · saved job or full resume${sb}`;
      case 'pick-saved':
        return `Generate · ↑↓ · Enter choose job${sb}`;
      case 'pick-flair':
        return `Generate · ↑↓ flair · Enter continue${sb}`;
      case 'building':
        return `Generate · building resume… · Esc cancels when supported${sb}`;
      case 'pick-sections':
        return `Generate · Space toggle · Enter PDF · Esc back${sb}`;
      case 'done':
        return `Generate · ↑↓ Enter next step · letter keys / palette${sb}`;
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
        leaveGenerateSurface();
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
      if (phase.p === 'pick-sections') {
        builtForRenderRef.current = null;
        setPhase({ p: 'pick-flair', ...phase.ctx });
        return;
      }
      if (phase.p === 'done') {
        leaveGenerateSurface();
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
    if (phase.p !== 'pick-sections') {
      return;
    }
    const ctx = phase.ctx;
    if (!ctx.jobId) {
      setCoverLetterExportable(false);
      return;
    }
    const slug = makeJobSlug(ctx.company, ctx.title);
    let cancelled = false;
    void readCoverLetterDraft(profileDir, slug).then((d) => {
      if (!cancelled) {
        setCoverLetterExportable(d != null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phase, profileDir]);

  useEffect(() => {
    if (phase.p !== 'pick-sections') {
      return;
    }
    if (!coverLetterExportable) {
      setSectionItems((prev) => prev.filter((i) => i.value !== '__cover_pdf__'));
      return;
    }
    setSectionItems((prev) => {
      if (prev.some((i) => i.value === '__cover_pdf__')) {
        return prev;
      }
      return [
        ...prev,
        {
          value: '__cover_pdf__',
          label: 'Also export cover letter PDF',
          checked: true,
        },
      ];
    });
  }, [phase.p, coverLetterExportable]);

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

  const runRenderPhase = useCallback(
    async (built: TuiGenerateBuiltState, sectionSelection: string[]) => {
      lastPickedSectionSelectionRef.current = sectionSelection;
      setPhase({ p: 'run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      const ac = createController();
      try {
        const alsoExport =
          sectionItems.find((i) => i.value === '__cover_pdf__')?.checked === true &&
          coverLetterExportable;
        const { outputPath, config, coverLetterPath } = await runTuiGenerateRenderPhase(built, {
          sectionSelection,
          signal: ac.signal,
          onProgress: setRunStepIndex,
          alsoExportCoverLetter: alsoExport,
        });
        lastSectionSelectionRef.current = config.sectionSelection ?? sectionSelection;
        setApiFailureStreak(0);
        setDoneMenuIdx(0);
        setPhase({ p: 'done', path: outputPath, coverLetterPath });
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
    [coverLetterExportable, createController, dispatch, releaseController, sectionItems],
  );

  const startBuildPhase = useCallback(
    async (ctx: GenerateRunCtx) => {
      recoverFlairRef.current = {
        jd: ctx.jd,
        jobId: ctx.jobId,
        title: ctx.title,
        company: ctx.company,
        idx: ctx.idx,
      };
      lastGenCtxRef.current = ctx;
      lastPickedSectionSelectionRef.current = null;
      setRunStepIndex(0);
      setPhase({ p: 'building', ctx });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      const ac = createController();
      try {
        const built = await runTuiGenerateBuildPhase({
          profileDir,
          flair: ctx.flair,
          templateOverride: ctx.templateOverride,
          jd: ctx.jd,
          jobId: ctx.jobId,
          jobTitle: ctx.title,
          company: ctx.company,
          signal: ac.signal,
          onProgress: setRunStepIndex,
        });
        builtForRenderRef.current = built;
        const items = buildSectionCheckboxItems(
          built.resumeDocFull,
          lastSectionSelectionRef.current ?? undefined,
        );
        setSectionItems(items);
        setSectionFocusIdx(0);
        setPhase({ p: 'pick-sections', ctx });
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

  if (phase.p === 'building' || phase.p === 'run') {
    const jd = phase.p === 'building' ? phase.ctx.jd : (lastGenCtxRef.current?.jd ?? undefined);
    const labels = jd ? [...JOB_PROGRESS_LABELS] : [...FULL_PROGRESS_LABELS];
    const cap = Math.max(0, Math.min(runStepIndex, labels.length));
    const spin =
      phase.p === 'building' ? 'Building resume (analyze, curate, assemble)…' : 'Running pipeline…';
    return (
      <Box flexDirection="column">
        <Text bold>Generate</Text>
        <ProgressSteps steps={labels} currentIndex={cap} />
        <Box marginTop={1}>
          <Spinner label={spin} />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'pick-sections') {
    const built = builtForRenderRef.current;
    return (
      <Box flexDirection="column">
        <Text bold>Generate</Text>
        {phase.ctx.jd ? (
          <Text>
            Job: {phase.ctx.title} @ {phase.ctx.company}
          </Text>
        ) : (
          <Text dimColor>Full resume</Text>
        )}
        <Text dimColor>
          Include in PDF — first {MIN_VISIBLE_RESUME_POSITIONS} roles (when you have that many) stay
          on for a full experience block; gaps between selected roles are filled automatically.
        </Text>
        {phase.ctx.jobId && !coverLetterExportable ? (
          <Text dimColor>
            Cover letter PDF: add a draft from Jobs (job detail) first, or leave the checkbox off.
          </Text>
        ) : null}
        <Box marginTop={1}>
          {built == null ? (
            <Text color="red">Internal error — no built document. Esc to go back.</Text>
          ) : sectionItems.length === 0 ? (
            <Text dimColor>Nothing to toggle — Enter to continue.</Text>
          ) : (
            <CheckboxList
              items={sectionItems}
              focusedIndex={sectionFocusIdx}
              onFocusChange={setSectionFocusIdx}
              onItemsChange={setSectionItems}
              isActive={active}
              onConfirm={() => {
                const b = builtForRenderRef.current;
                if (!b) {
                  return;
                }
                const selected =
                  sectionItems.length === 0
                    ? collectDefaultSectionKeys(b.resumeDocFull)
                    : sectionItems
                        .filter((i) => i.checked && i.value !== '__cover_pdf__')
                        .map((i) => i.value);
                void runRenderPhase(b, selected);
              }}
            />
          )}
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
        {phase.coverLetterPath ? (
          <Box marginTop={1}>
            <Text dimColor>Cover letter: {phase.coverLetterPath}</Text>
          </Box>
        ) : null}
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
                  void startBuildPhase(ctx);
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
              const built = builtForRenderRef.current;
              const picked = lastPickedSectionSelectionRef.current;
              if (built != null && picked != null) {
                void runRenderPhase(built, picked);
              } else {
                const ctx = lastGenCtxRef.current;
                if (ctx) {
                  void startBuildPhase(ctx);
                }
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'pick-flair') {
    const flairItems = FLAIR_CHOICES.map((c) => ({
      value: c.value,
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
              const choice = FLAIR_CHOICES.find((c) => c.value === item.value);
              if (!choice) {
                return;
              }
              void startBuildPhase({
                jd: phase.jd,
                jobId: phase.jobId,
                title: phase.title,
                company: phase.company,
                idx: phase.idx,
                flair: choice.flair,
                templateOverride: choice.templateOverride,
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
