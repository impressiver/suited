import { createHash } from 'node:crypto';
import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvaluation } from '../../claude/prompts/consultant.ts';
import { applyJobFeedback, evaluateForJob } from '../../generate/consultant.ts';
import { buildRefMapForProfile } from '../../generate/curator.ts';
import { assembleResumeDocument, getFlairInfo } from '../../generate/resume-builder.ts';
import type { SavedJob } from '../../profile/schema.ts';
import {
  deleteJob,
  loadActiveProfile,
  loadJobRefinement,
  loadJobs,
  makeJobSlug,
  saveJob,
} from '../../profile/serializer.ts';
import { lightRefineCoverLetter, sniffCoverLetter } from '../../services/coverLetterAssist.ts';
import { readCoverLetterDraft, saveCoverLetterDraft } from '../../services/coverLetterPdf.ts';
import { formatCurationPreviewLines } from '../../services/curationPreview.ts';
import { formatJobEvaluationLines } from '../../services/jobEvaluationText.ts';
import { runJobRefinementPipeline } from '../../services/jobRefinement.ts';
import type { DiffBlock } from '../../services/refine.ts';
import {
  globalRefinedTarget,
  jobRefinedTarget,
  persistenceTargetsEqual,
} from '../activeDocumentSession.ts';
import { ResumeEditor } from '../components/ResumeEditor.tsx';
import {
  type ResumeEditorContextValue,
  ResumeEditorProvider,
} from '../components/ResumeEditorContext.tsx';
import {
  ConfirmPrompt,
  DiffView,
  MultilineInput,
  ScrollView,
  SelectList,
  Spinner,
  TextInput,
  TextViewport,
} from '../components/shared/index.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { jobsListPaneWidth, jobsUseSplitPane } from '../jobsLayout.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import {
  panelContentViewportRows,
  panelFramedTextWidth,
  panelInnerWidth,
} from '../panelContentWidth.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';
import { linesToWrappedRows, splitLinesForWrap, wrappedScrollMax } from '../utils/wrapTextRows.ts';

const ADD_SENTINEL = '__add__';

type Mode =
  | { m: 'list' }
  | { m: 'jobEditor'; job: SavedJob }
  | { m: 'detail'; job: SavedJob }
  | { m: 'addTitle' }
  | { m: 'addCompany'; title: string }
  | { m: 'addJd'; title: string; company: string }
  | { m: 'viewJd'; job: SavedJob; scroll: number }
  | { m: 'deleteAsk'; job: SavedJob; from: 'list' | 'detail' }
  | { m: 'prepareRun'; job: SavedJob }
  | {
      m: 'prepareOk';
      job: SavedJob;
      previewLines: string[];
      prepScroll: number;
      nPos: number;
      nSkills: number;
    }
  | { m: 'viewPrep'; job: SavedJob; lines: string[]; scroll: number }
  | { m: 'feedbackRun'; job: SavedJob }
  | {
      m: 'feedbackView';
      job: SavedJob;
      evaluation: JobEvaluation;
      lines: string[];
      scroll: number;
    }
  | { m: 'feedbackApply'; job: SavedJob }
  | { m: 'feedbackDone'; note: string }
  | {
      m: 'coverLetterEdit';
      job: SavedJob;
      slug: string;
      draft: string;
      menuIndex: number;
    }
  | {
      m: 'coverLetterReview';
      job: SavedJob;
      slug: string;
      before: string;
      proposed: string;
      reviewMenuIdx: number;
    }
  | { m: 'err'; msg: string; canRetryPrepare?: boolean };

function jobFromMode(mode: Mode): SavedJob | null {
  switch (mode.m) {
    case 'jobEditor':
    case 'detail':
    case 'viewJd':
    case 'deleteAsk':
    case 'prepareRun':
    case 'prepareOk':
    case 'viewPrep':
    case 'feedbackRun':
    case 'feedbackView':
    case 'feedbackApply':
      return mode.job;
    case 'coverLetterEdit':
    case 'coverLetterReview':
      return mode.job;
    default:
      return null;
  }
}

/** Extracted component so hooks (useMemo/useCallback) can stabilize context for ResumeEditor. */
function JobEditorWrapper({
  job,
  snapshot,
  profileDir,
  onClose,
  onRefresh,
}: {
  job: SavedJob;
  snapshot: ProfileSnapshot;
  profileDir: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const slug = makeJobSlug(job.company, job.title);
  const editorContext = useMemo(
    (): ResumeEditorContextValue => ({
      mode: 'job',
      jobDescription: job.text,
      jobTitle: job.title,
      company: job.company,
      jobId: job.id,
      persistenceTarget: jobRefinedTarget(job.id, slug),
      onRequestClose: onClose,
    }),
    [job.id, job.text, job.title, job.company, slug, onClose],
  );
  return (
    <ResumeEditorProvider value={editorContext}>
      <ResumeEditor snapshot={snapshot} profileDir={profileDir} onRefreshSnapshot={onRefresh} />
    </ResumeEditorProvider>
  );
}

export interface JobsScreenProps {
  profileDir: string;
  snapshot: ProfileSnapshot;
}

export function JobsScreen({ profileDir, snapshot }: JobsScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { createController, releaseController } = useOperationAbort();
  const { activeScreen, focusTarget, inTextInput, operationInProgress, persistenceTarget } =
    useAppState();
  const [cols, rows] = useTerminalSize();
  const panelW = panelInnerWidth(cols);
  const textW = panelFramedTextWidth(cols);
  const jdViewScrollH = panelContentViewportRows(rows, 11);
  const prepScrollH = panelContentViewportRows(rows, 12);
  const feedbackScrollH = panelContentViewportRows(rows, 14);
  const jdEditorH = panelContentViewportRows(rows, 14);
  const splitPane = jobsUseSplitPane(cols);
  const listPaneW = jobsListPaneWidth(cols);

  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [prepLabel, setPrepLabel] = useState<Record<string, string>>({});
  const [listIndex, setListIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ m: 'list' });

  const [titleDraft, setTitleDraft] = useState('');
  const [companyDraft, setCompanyDraft] = useState('');
  const [jdDraft, setJdDraft] = useState('');
  const [errMenuIdx, setErrMenuIdx] = useState(0);
  const [prepareFailStreak, setPrepareFailStreak] = useState(0);
  const [detailRefinement, setDetailRefinement] = useState<Awaited<
    ReturnType<typeof loadJobRefinement>
  > | null>(null);
  const [feedbackMenuIdx, setFeedbackMenuIdx] = useState(0);
  const lastPrepareJobRef = useRef<SavedJob | null>(null);

  const reload = useCallback(async () => {
    const list = await loadJobs(profileDir);
    setJobs(list);
    const labels: Record<string, string> = {};
    for (const job of list) {
      const r = await loadJobRefinement(profileDir, job.id);
      labels[job.id] = r
        ? `prepared ${new Date(r.createdAt).toLocaleDateString()}`
        : 'not prepared';
    }
    setPrepLabel(labels);
    setListIndex((i) => (list.length === 0 ? 0 : Math.min(i, list.length)));
  }, [profileDir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (activeScreen !== 'jobs') {
      return;
    }
    const job = jobFromMode(mode);
    let next = globalRefinedTarget();
    if (job) {
      const id = job.id.trim();
      const slug = makeJobSlug(job.company, job.title);
      if (id && slug) {
        next = jobRefinedTarget(id, slug);
      }
    }
    if (!persistenceTargetsEqual(next, persistenceTarget)) {
      dispatch({ type: 'SET_PERSISTENCE_TARGET', target: next });
    }
  }, [activeScreen, dispatch, mode, persistenceTarget]);

  const detailJobId = mode.m === 'detail' ? mode.job.id : null;

  useEffect(() => {
    if (!detailJobId) {
      setDetailRefinement(null);
      return;
    }
    let cancelled = false;
    void loadJobRefinement(profileDir, detailJobId).then((r) => {
      if (!cancelled) {
        setDetailRefinement(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detailJobId, profileDir]);

  useEffect(() => {
    void detailRefinement;
    if (mode.m === 'detail') {
      setMenuIndex(0);
    }
  }, [detailRefinement, mode.m]);

  const listItems = useMemo(() => {
    const items = jobs.map((j) => ({
      value: j.id,
      label: `${j.title} @ ${j.company}  (${prepLabel[j.id] ?? '…'})`,
    }));
    items.push({ value: ADD_SENTINEL, label: '+ Add new job' });
    return items;
  }, [jobs, prepLabel]);

  const active = activeScreen === 'jobs' && focusTarget === 'content';

  useRegisterBlockingUi(active && (mode.m === 'err' || mode.m === 'coverLetterReview'));

  const jobsFooterHint = useMemo(() => {
    const sb = ' · : palette';
    switch (mode.m) {
      case 'list':
        return `Jobs · ↑↓ · Enter open · a add · d delete · p prepare · g generate · preview below list${sb}`;
      case 'detail':
        return `Jobs · ↑↓ · Enter · a d g p · Esc list${sb}`;
      case 'addTitle':
      case 'addCompany':
        return `Jobs · Esc back · Enter next${sb}`;
      case 'addJd':
        return `Jobs · Ctrl+D or Ctrl+S save · PgUp/PgDn · ↑↓ scroll · Esc back${sb}`;
      case 'viewJd':
        return `Jobs · ↑↓ PgUp/PgDn scroll JD · Esc → job menu${sb}`;
      case 'deleteAsk':
        return `Jobs · Enter confirm delete · Esc cancel${sb}`;
      case 'prepareOk':
        return `Jobs · ↑↓ PgUp/PgDn scroll · Esc → list${sb}`;
      case 'viewPrep':
        return `Jobs · ↑↓ PgUp/PgDn scroll · Esc → job menu${sb}`;
      case 'feedbackView':
        return `Jobs · PgUp/PgDn scroll text · ↑↓ actions · Enter · Esc back${sb}`;
      case 'feedbackDone':
        return `Jobs · Esc → list${sb}`;
      case 'coverLetterEdit':
        return `Jobs · Cover letter · ↑↓ menu · Enter · Ctrl+D save from editor · Esc back${sb}`;
      case 'coverLetterReview':
        return `Jobs · Review · ↑↓ · Enter accept/reject · Esc reject${sb}`;
      case 'err':
        return `Jobs · ↑↓ Enter · Esc → list when menu not focused${sb}`;
      default:
        return `Jobs${sb}`;
    }
  }, [mode.m]);

  useRegisterPanelFooterHint(jobsFooterHint);

  const listJob = useCallback((): SavedJob | null => {
    const id = listItems[listIndex]?.value;
    if (!id || id === ADD_SENTINEL) {
      return null;
    }
    return jobs.find((j) => j.id === id) ?? null;
  }, [jobs, listIndex, listItems]);

  useEffect(() => {
    const defer =
      activeScreen === 'jobs' &&
      focusTarget === 'content' &&
      (mode.m === 'list' || mode.m === 'detail' || mode.m === 'jobEditor' || mode.m === 'coverLetterEdit') &&
      !operationInProgress;
    dispatch({
      type: 'SET_DEFER_LETTER_SHORTCUTS',
      screen: defer ? 'jobs' : null,
    });
    return () => {
      dispatch({ type: 'SET_DEFER_LETTER_SHORTCUTS', screen: null });
    };
  }, [activeScreen, dispatch, focusTarget, mode.m, operationInProgress]);

  const goGenerate = useCallback(
    (job: SavedJob) => {
      dispatch({ type: 'SET_PENDING_JOB', jobId: job.id });
      navigate('generate');
    },
    [dispatch, navigate],
  );

  const runFeedback = useCallback(
    async (job: SavedJob) => {
      setMode({ m: 'feedbackRun', job });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const refinement = await loadJobRefinement(profileDir, job.id);
        if (!refinement) {
          throw new Error('Prepare this job first (p).');
        }
        const profile = await loadActiveProfile(profileDir);
        const refMap = buildRefMapForProfile(profile);
        const { effectiveFlair } = getFlairInfo(3, refinement.jobAnalysis.industry);
        const doc = assembleResumeDocument(
          profile,
          refinement.plan,
          refMap,
          effectiveFlair,
          refinement.jobAnalysis.industry,
          job.title,
          job.company,
        );
        const evaluation = await evaluateForJob(doc, refinement.jobAnalysis);
        const lines = formatJobEvaluationLines(evaluation);
        setFeedbackMenuIdx(0);
        setMode({ m: 'feedbackView', job, evaluation, lines, scroll: 0 });
      } catch (e) {
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  const applyFeedbackGaps = useCallback(
    async (job: SavedJob, evaluation: JobEvaluation) => {
      if (evaluation.gaps.length === 0) {
        setMode({ m: 'feedbackDone', note: 'No gaps in the review — nothing to apply.' });
        return;
      }
      setMode({ m: 'feedbackApply', job });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const refinement = await loadJobRefinement(profileDir, job.id);
        if (!refinement) {
          throw new Error('Lost job preparation — run Prepare again.');
        }
        const profile = await loadActiveProfile(profileDir);
        const refMap = buildRefMapForProfile(profile);
        const { effectiveFlair } = getFlairInfo(3, refinement.jobAnalysis.industry);
        const doc = assembleResumeDocument(
          profile,
          refinement.plan,
          refMap,
          effectiveFlair,
          refinement.jobAnalysis.industry,
          job.title,
          job.company,
        );
        await applyJobFeedback(doc, refinement.jobAnalysis, evaluation.gaps);
        setMode({
          m: 'feedbackDone',
          note: `Applied ${evaluation.gaps.length} gap suggestion(s) to the tailored resume draft (in-memory). Run Generate with this job to build an updated PDF.`,
        });
      } catch (e) {
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  const runPrepare = useCallback(
    async (job: SavedJob) => {
      setMode({ m: 'prepareRun', job });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadJobRefinement(profileDir, job.id);
        const r = await runJobRefinementPipeline(profileDir, job, existing);
        const profile = await loadActiveProfile(profileDir);
        const previewLines = formatCurationPreviewLines(profile, r.plan, job.company, job.title);
        setPrepareFailStreak(0);
        setMode({
          m: 'prepareOk',
          job,
          previewLines,
          prepScroll: 0,
          nPos: r.plan.selectedPositions.length,
          nSkills: r.plan.selectedSkillIds.length,
        });
        await reload();
      } catch (e) {
        lastPrepareJobRef.current = job;
        setPrepareFailStreak((n) => n + 1);
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: true });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir, reload],
  );

  const startAdd = useCallback(() => {
    setTitleDraft('');
    setCompanyDraft('');
    setJdDraft('');
    setMode({ m: 'addTitle' });
  }, []);

  const openListJob = useCallback(
    (item: { value: string }) => {
      if (item.value === ADD_SENTINEL) {
        startAdd();
        return;
      }
      const j = jobs.find((x) => x.id === item.value);
      if (j) {
        setMenuIndex(0);
        setMode({ m: 'jobEditor', job: j });
      }
    },
    [jobs, startAdd],
  );

  useInput(
    (input, _key) => {
      if (!active || inTextInput) {
        return;
      }
      if (mode.m === 'list' || mode.m === 'detail') {
        if (operationInProgress) {
          return;
        }
        const ch = input.toLowerCase();
        if (ch === 'a') {
          startAdd();
          return;
        }
        const job = mode.m === 'detail' ? mode.job : listJob();
        if (ch === 'd' && job) {
          setMode({ m: 'deleteAsk', job, from: mode.m === 'detail' ? 'detail' : 'list' });
          return;
        }
        if (ch === 'p' && job) {
          void runPrepare(job);
          return;
        }
        if (ch === 'g' && job) {
          goGenerate(job);
        }
      }
    },
    { isActive: active },
  );

  useInput(
    (_input, key) => {
      if (!active || !key.escape) {
        return;
      }
      // Add-job wizard: Esc backs out even while TextInput / MultilineInput holds stdin.
      if (mode.m === 'addTitle') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'addCompany') {
        setMode({ m: 'addTitle' });
        return;
      }
      if (mode.m === 'addJd') {
        setMode({ m: 'addCompany', title: mode.title });
        setCompanyDraft(mode.company);
        return;
      }
      if (inTextInput) {
        return;
      }
      if (mode.m === 'viewJd') {
        setMode({ m: 'detail', job: mode.job });
        return;
      }
      if (mode.m === 'deleteAsk') {
        return;
      }
      if (mode.m === 'detail') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'coverLetterReview') {
        setMode({
          m: 'coverLetterEdit',
          job: mode.job,
          slug: mode.slug,
          draft: mode.before,
          menuIndex: 0,
        });
        return;
      }
      if (mode.m === 'coverLetterEdit') {
        setMode({ m: 'detail', job: mode.job });
        return;
      }
      if (mode.m === 'viewPrep' || mode.m === 'feedbackView') {
        setMode({ m: 'detail', job: mode.job });
        return;
      }
      if (mode.m === 'prepareOk' || mode.m === 'feedbackDone') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'err') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'list') {
        navigate('dashboard');
      }
    },
    { isActive: active },
  );

  useInput(
    (_input, key) => {
      if (!active || mode.m !== 'viewJd' || inTextInput) {
        return;
      }
      const lines = splitLinesForWrap(mode.job.text);
      const maxScroll = wrappedScrollMax(lines, jdViewScrollH, textW);
      const step = Math.max(1, jdViewScrollH - 1);
      if (key.pageUp) {
        setMode((m) => (m.m === 'viewJd' ? { ...m, scroll: Math.max(0, m.scroll - step) } : m));
      }
      if (key.pageDown) {
        setMode((m) =>
          m.m === 'viewJd' ? { ...m, scroll: Math.min(maxScroll, m.scroll + step) } : m,
        );
      }
      if (key.upArrow) {
        setMode((m) => (m.m === 'viewJd' ? { ...m, scroll: Math.max(0, m.scroll - 1) } : m));
      }
      if (key.downArrow) {
        setMode((m) =>
          m.m === 'viewJd' ? { ...m, scroll: Math.min(maxScroll, m.scroll + 1) } : m,
        );
      }
    },
    { isActive: active && mode.m === 'viewJd' },
  );

  useInput(
    (_input, key) => {
      if (!active || inTextInput) {
        return;
      }
      if (!(mode.m === 'prepareOk' || mode.m === 'viewPrep' || mode.m === 'feedbackView')) {
        return;
      }
      const h = mode.m === 'feedbackView' ? feedbackScrollH : prepScrollH;
      const lines = mode.m === 'prepareOk' ? mode.previewLines : mode.lines;
      const scroll = mode.m === 'prepareOk' ? mode.prepScroll : mode.scroll;
      const maxScroll = wrappedScrollMax(lines, h, textW);
      const step = Math.max(1, h - 1);

      const applyScroll = (next: number) => {
        if (mode.m === 'prepareOk') {
          setMode({ ...mode, prepScroll: next });
        } else if (mode.m === 'viewPrep') {
          setMode({ ...mode, scroll: next });
        } else {
          setMode({ ...mode, scroll: next });
        }
      };

      if (key.pageUp) {
        applyScroll(Math.max(0, scroll - step));
      }
      if (key.pageDown) {
        applyScroll(Math.min(maxScroll, scroll + step));
      }

      if (mode.m !== 'feedbackView') {
        if (key.upArrow) {
          applyScroll(Math.max(0, scroll - 1));
        }
        if (key.downArrow) {
          applyScroll(Math.min(maxScroll, scroll + 1));
        }
      }
    },
    {
      isActive:
        active && (mode.m === 'prepareOk' || mode.m === 'viewPrep' || mode.m === 'feedbackView'),
    },
  );

  const detailMenuItems = useMemo(() => {
    const items: { value: string; label: string }[] = [
      { value: 'jd', label: 'View job description' },
      { value: 'cover', label: 'Cover letter (edit)' },
    ];
    if (detailRefinement) {
      items.push(
        { value: 'viewPrep', label: 'View preparation (curation summary)' },
        { value: 'feedback', label: 'Professional feedback (job fit)' },
      );
    }
    items.push(
      {
        value: 'prep',
        label: detailRefinement ? 'Re-prepare (re-run curation)' : 'Prepare (curate for this job)',
      },
      { value: 'gen', label: 'Open Generate with this job' },
      { value: 'del', label: 'Delete this job' },
      { value: 'back', label: '← Back to list' },
    );
    return items;
  }, [detailRefinement]);

  const runCoverAssist = useCallback(
    async (kind: 'refine' | 'sniff') => {
      if (mode.m !== 'coverLetterEdit') {
        return;
      }
      const { job, slug, draft } = mode;
      if (!draft.trim()) {
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: 'Cover letter is empty.', canRetryPrepare: false });
        return;
      }
      const ac = createController();
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const ctx = { company: job.company, jobTitle: job.title, jdExcerpt: job.text };
        const gen =
          kind === 'refine'
            ? lightRefineCoverLetter(draft, ctx, ac.signal)
            : sniffCoverLetter(draft, ctx, ac.signal);
        let proposed = '';
        for await (const ev of gen) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        setMode({
          m: 'coverLetterReview',
          job,
          slug,
          before: draft,
          proposed,
          reviewMenuIdx: 0,
        });
      } catch (e) {
        if (!isUserAbort(e)) {
          setErrMenuIdx(0);
          setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
        }
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, mode, releaseController],
  );

  const finalizeNewJob = useCallback(
    async (jd: string, title: string, company: string) => {
      const text = jd.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (!text) {
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: 'Job description is empty.' });
        return;
      }
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const textHash = createHash('sha256').update(text).digest('hex');
        const newJob: SavedJob = {
          id: `job-${Date.now()}`,
          company: company.trim() || 'Unknown Company',
          title: title.trim() || 'Unknown Role',
          savedAt: new Date().toISOString(),
          text,
          textHash,
        };
        await saveJob(newJob, profileDir);
        await reload();
        setMode({ m: 'list' });
      } catch (e) {
        setErrMenuIdx(0);
        setMode({ m: 'err', msg: (e as Error).message });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir, reload],
  );

  const handleJobEditorClose = useCallback(() => {
    dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
    setMode({ m: 'list' });
    void reload();
  }, [dispatch, reload]);

  const handleJobEditorRefresh = useCallback(() => {
    void reload();
  }, [reload]);

  if (mode.m === 'jobEditor') {
    return (
      <JobEditorWrapper
        job={mode.job}
        snapshot={snapshot}
        profileDir={profileDir}
        onClose={handleJobEditorClose}
        onRefresh={handleJobEditorRefresh}
      />
    );
  }

  if (mode.m === 'prepareRun') {
    return (
      <Box flexDirection="column">
        <Text bold>Jobs</Text>
        <Spinner label={`Preparing ${mode.job.title} @ ${mode.job.company}…`} />
      </Box>
    );
  }

  if (mode.m === 'prepareOk') {
    const prepRows = linesToWrappedRows(mode.previewLines, textW);
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Prepared</Text>
        <Text color="green">
          {mode.job.title} @ {mode.job.company} — {mode.nPos} positions · {mode.nSkills} skills
        </Text>
        <Box marginTop={1} flexGrow={1}>
          <TextViewport
            panelWidth={panelW}
            viewportHeight={prepScrollH}
            scrollOffset={mode.prepScroll}
            totalRows={prepRows.length}
            kind="Curation summary"
          >
            <ScrollView
              displayLines={prepRows}
              height={prepScrollH}
              scrollOffset={mode.prepScroll}
              padToWidth={textW}
            />
          </TextViewport>
        </Box>
      </Box>
    );
  }

  if (mode.m === 'viewPrep') {
    const prepViewRows = linesToWrappedRows(mode.lines, textW);
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>
          Preparation — {mode.job.title} @ {mode.job.company}
        </Text>
        <Box marginTop={1} flexGrow={1}>
          <TextViewport
            panelWidth={panelW}
            viewportHeight={prepScrollH}
            scrollOffset={mode.scroll}
            totalRows={prepViewRows.length}
            kind="Preparation"
          >
            <ScrollView
              displayLines={prepViewRows}
              height={prepScrollH}
              scrollOffset={mode.scroll}
              padToWidth={textW}
            />
          </TextViewport>
        </Box>
      </Box>
    );
  }

  if (mode.m === 'feedbackRun') {
    return (
      <Box flexDirection="column">
        <Text bold>Jobs</Text>
        <Spinner label={`Job fit review — ${mode.job.title} @ ${mode.job.company}…`} />
      </Box>
    );
  }

  if (mode.m === 'feedbackView') {
    const feedbackRows = linesToWrappedRows(mode.lines, textW);
    const feedbackItems = [
      { value: 'apply', label: 'Apply gap suggestions to tailored draft' },
      { value: 'back', label: '← Back to job menu' },
    ];
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Professional feedback</Text>
        <Box marginTop={1} flexGrow={1}>
          <TextViewport
            panelWidth={panelW}
            viewportHeight={feedbackScrollH}
            scrollOffset={mode.scroll}
            totalRows={feedbackRows.length}
            kind="Feedback"
          >
            <ScrollView
              displayLines={feedbackRows}
              height={feedbackScrollH}
              scrollOffset={mode.scroll}
              padToWidth={textW}
            />
          </TextViewport>
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={feedbackItems}
            selectedIndex={feedbackMenuIdx}
            onChange={(i) => setFeedbackMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'apply') {
                void applyFeedbackGaps(mode.job, mode.evaluation);
              } else {
                setMode({ m: 'detail', job: mode.job });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'feedbackApply') {
    return (
      <Box flexDirection="column">
        <Text bold>Jobs</Text>
        <Spinner label="Applying feedback to tailored resume draft…" />
      </Box>
    );
  }

  if (mode.m === 'feedbackDone') {
    return (
      <Box flexDirection="column">
        <Text bold color="green">
          Feedback
        </Text>
        <Text>{mode.note}</Text>
      </Box>
    );
  }

  if (mode.m === 'coverLetterEdit' && operationInProgress) {
    return (
      <Box flexDirection="column">
        <Text bold>Cover letter</Text>
        <Spinner label="AI assist…" />
      </Box>
    );
  }

  if (mode.m === 'coverLetterReview') {
    const blocks: DiffBlock[] = [{ kind: 'summary', old: mode.before, new: mode.proposed }];
    const reviewItems = [
      { value: 'accept', label: 'Accept and replace draft' },
      { value: 'reject', label: 'Reject' },
    ];
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Cover letter — review</Text>
        <Text dimColor>↑↓ · Enter · Esc rejects</Text>
        <Box marginTop={1} flexGrow={1}>
          <DiffView blocks={blocks} />
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={reviewItems}
            selectedIndex={mode.reviewMenuIdx}
            onChange={(i) =>
              setMode((m) => (m.m === 'coverLetterReview' ? { ...m, reviewMenuIdx: i } : m))
            }
            isActive={active}
            onSubmit={(item) => {
              if (mode.m !== 'coverLetterReview') {
                return;
              }
              const rev = mode;
              if (item.value === 'reject') {
                setMode({
                  m: 'coverLetterEdit',
                  job: rev.job,
                  slug: rev.slug,
                  draft: rev.before,
                  menuIndex: 0,
                });
                return;
              }
              void (async () => {
                try {
                  await saveCoverLetterDraft(profileDir, rev.slug, rev.proposed);
                  setMode({
                    m: 'coverLetterEdit',
                    job: rev.job,
                    slug: rev.slug,
                    draft: rev.proposed,
                    menuIndex: 0,
                  });
                } catch (e) {
                  setErrMenuIdx(0);
                  setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
                }
              })();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'coverLetterEdit') {
    const coverMenu = [
      { value: 'refine', label: 'Light refine (grammar, clarity)' },
      { value: 'sniff', label: 'AI sniff pass (less generic phrasing)' },
      { value: 'save', label: 'Save to disk' },
      { value: 'back', label: '← Back to job menu' },
    ];
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>
          Cover letter — {mode.job.title} @ {mode.job.company}
        </Text>
        <Text dimColor>
          Markdown · Ctrl+D or Ctrl+S to save from editor · Esc to job menu · empty draft blocks AI
        </Text>
        <Box marginTop={1} flexGrow={1}>
          <MultilineInput
            value={mode.draft}
            onChange={(next) =>
              setMode((m) => (m.m === 'coverLetterEdit' ? { ...m, draft: next } : m))
            }
            focus={active}
            width={textW}
            height={jdEditorH}
            onSubmit={(text) => {
              void (async () => {
                try {
                  await saveCoverLetterDraft(profileDir, mode.slug, text);
                } catch (e) {
                  setErrMenuIdx(0);
                  setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
                }
              })();
            }}
          />
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={coverMenu}
            selectedIndex={mode.menuIndex}
            onChange={(i) =>
              setMode((m) => (m.m === 'coverLetterEdit' ? { ...m, menuIndex: i } : m))
            }
            isActive={active && !inTextInput}
            onSubmit={(item) => {
              if (item.value === 'back') {
                setMode({ m: 'detail', job: mode.job });
                return;
              }
              if (item.value === 'save') {
                void (async () => {
                  try {
                    await saveCoverLetterDraft(profileDir, mode.slug, mode.draft);
                  } catch (e) {
                    setErrMenuIdx(0);
                    setMode({ m: 'err', msg: (e as Error).message, canRetryPrepare: false });
                  }
                })();
                return;
              }
              if (item.value === 'refine') {
                void runCoverAssist('refine');
                return;
              }
              if (item.value === 'sniff') {
                void runCoverAssist('sniff');
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'err') {
    const showSettings = prepareFailStreak >= 3 && mode.canRetryPrepare;
    const errItems = [
      ...(mode.canRetryPrepare ? [{ value: 'retry' as const, label: 'Retry prepare' }] : []),
      ...(showSettings ? [{ value: 'settings' as const, label: 'Check Settings (API key)' }] : []),
      { value: 'back' as const, label: 'Back to list' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Jobs — error</Text>
        <Text color="red">{mode.msg}</Text>
        {showSettings && (
          <Box marginTop={1}>
            <Text dimColor>Several prepare failures — verify API key in Settings.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={errItems}
            selectedIndex={errMenuIdx}
            onChange={(i) => setErrMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'settings') {
                setPrepareFailStreak(0);
                navigate('settings');
                dispatch({ type: 'SET_FOCUS', target: 'content' });
                setMode({ m: 'list' });
                return;
              }
              if (item.value === 'retry') {
                const j = lastPrepareJobRef.current;
                if (j) {
                  setErrMenuIdx(0);
                  void runPrepare(j);
                }
                return;
              }
              setPrepareFailStreak(0);
              setMode({ m: 'list' });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'deleteAsk') {
    return (
      <ConfirmPrompt
        message={`Delete "${mode.job.title} @ ${mode.job.company}"?`}
        active={active}
        onConfirm={async () => {
          try {
            await deleteJob(mode.job.id, profileDir);
            await reload();
          } catch (e) {
            setErrMenuIdx(0);
            setMode({ m: 'err', msg: (e as Error).message });
            return;
          }
          setMode({ m: 'list' });
        }}
        onCancel={() => {
          if (mode.from === 'detail') {
            setMode({ m: 'detail', job: mode.job });
          } else {
            setMode({ m: 'list' });
          }
        }}
      />
    );
  }

  if (mode.m === 'viewJd') {
    const lines = splitLinesForWrap(mode.job.text);
    const jdRows = linesToWrappedRows(lines, textW);
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>
          JD — {mode.job.title} @ {mode.job.company}
        </Text>
        <Text dimColor>Read-only · Esc returns to job menu</Text>
        <Box marginTop={1} flexGrow={1}>
          <TextViewport
            panelWidth={panelW}
            viewportHeight={jdViewScrollH}
            scrollOffset={mode.scroll}
            totalRows={jdRows.length}
            kind="Job description"
          >
            <ScrollView
              displayLines={jdRows}
              height={jdViewScrollH}
              scrollOffset={mode.scroll}
              padToWidth={textW}
            />
          </TextViewport>
        </Box>
      </Box>
    );
  }

  if (mode.m === 'addTitle') {
    return (
      <Box flexDirection="column">
        <Text bold>Add job — title</Text>
        <TextInput
          value={titleDraft}
          onChange={setTitleDraft}
          focus={active}
          placeholder="Job title (optional)"
          onSubmit={(v) => {
            setTitleDraft(v);
            setMode({ m: 'addCompany', title: v });
          }}
        />
      </Box>
    );
  }

  if (mode.m === 'addCompany') {
    return (
      <Box flexDirection="column">
        <Text bold>Add job — company</Text>
        <TextInput
          value={companyDraft}
          onChange={setCompanyDraft}
          focus={active}
          placeholder="Company (optional)"
          onSubmit={(v) => {
            setCompanyDraft(v);
            setMode({ m: 'addJd', title: mode.title, company: v });
          }}
        />
      </Box>
    );
  }

  if (mode.m === 'addJd') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Add job — description</Text>
        <Text dimColor>
          Paste or type the JD, then <Text bold>Ctrl+D</Text> or <Text bold>Ctrl+S</Text> to save ·
          PgUp/PgDn · ↑↓ scroll · Esc → company step
        </Text>
        <Box marginTop={1} flexGrow={1}>
          <MultilineInput
            value={jdDraft}
            onChange={setJdDraft}
            focus={active}
            width={textW}
            height={jdEditorH}
            onSubmit={(text) => {
              void finalizeNewJob(text, mode.title, mode.company);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode.m === 'detail') {
    const detailBody = (
      <Box flexDirection="column">
        <Text bold>
          {mode.job.title} @ {mode.job.company}
        </Text>
        <Box marginTop={1}>
          <SelectList
            items={detailMenuItems}
            selectedIndex={menuIndex}
            onChange={(i) => setMenuIndex(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'jd') {
                setMode({ m: 'viewJd', job: mode.job, scroll: 0 });
              } else if (item.value === 'cover') {
                void (async () => {
                  const slug = makeJobSlug(mode.job.company, mode.job.title);
                  const existing = await readCoverLetterDraft(profileDir, slug);
                  setMode({
                    m: 'coverLetterEdit',
                    job: mode.job,
                    slug,
                    draft: existing ?? '',
                    menuIndex: 0,
                  });
                })();
              } else if (item.value === 'viewPrep') {
                void (async () => {
                  const r = await loadJobRefinement(profileDir, mode.job.id);
                  const p = await loadActiveProfile(profileDir);
                  if (!r) {
                    setErrMenuIdx(0);
                    setMode({
                      m: 'err',
                      msg: 'No preparation for this job yet.',
                      canRetryPrepare: false,
                    });
                    return;
                  }
                  const lines = formatCurationPreviewLines(
                    p,
                    r.plan,
                    mode.job.company,
                    mode.job.title,
                  );
                  setMode({ m: 'viewPrep', job: mode.job, lines, scroll: 0 });
                })();
              } else if (item.value === 'feedback') {
                void runFeedback(mode.job);
              } else if (item.value === 'prep') {
                void runPrepare(mode.job);
              } else if (item.value === 'gen') {
                goGenerate(mode.job);
              } else if (item.value === 'del') {
                setMode({ m: 'deleteAsk', job: mode.job, from: 'detail' });
              } else if (item.value === 'back') {
                setMode({ m: 'list' });
              }
            }}
          />
        </Box>
      </Box>
    );

    if (splitPane) {
      return (
        <Box flexDirection="row" flexGrow={1}>
          <Box width={listPaneW} flexDirection="column">
            <Text bold>Saved jobs</Text>
            <Box marginTop={1}>
              <SelectList
                items={listItems}
                selectedIndex={listIndex}
                onChange={(i) => setListIndex(i)}
                isActive={false}
                onSubmit={openListJob}
              />
            </Box>
          </Box>
          <Box marginLeft={1} flexDirection="column" flexGrow={1}>
            {detailBody}
          </Box>
        </Box>
      );
    }

    return detailBody;
  }

  const previewJob = listJob();
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column">
        <Text bold>Saved jobs</Text>
        <Box marginTop={1}>
          <SelectList
            items={listItems}
            selectedIndex={listIndex}
            onChange={(i) => setListIndex(i)}
            isActive={active && mode.m === 'list'}
            onSubmit={openListJob}
          />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold dimColor>
          Preview
        </Text>
        {previewJob ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              {previewJob.title} @ {previewJob.company}
            </Text>
            <Text dimColor>{prepLabel[previewJob.id] ?? '…'}</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>No job selected (move ↑↓ on the list)</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
