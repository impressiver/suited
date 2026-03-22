import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConsultantFinding,
  FeedbackQuestion,
  ProfileEvaluation,
} from '../../claude/prompts/consultant.ts';
import { profileToRefineText } from '../../claude/prompts/refine.ts';
import {
  evaluateProfile,
  fetchConsultantFeedbackQuestions,
  mergeConsultantFindingAnswers,
} from '../../generate/consultant.ts';
import { markdownToProfile } from '../../profile/markdown.ts';
import type { RefinementHistoryListEntry } from '../../profile/refinementHistory.ts';
import type {
  Profile,
  RefinementQuestion,
  RefinementSession,
  Sourced,
} from '../../profile/schema.ts';
import type { RefinementSaveReason } from '../../profile/serializer.ts';
import {
  hashSource,
  isMdNewerThanJson,
  loadRefined,
  loadSource,
  refinedJsonPath,
  refinedMdPath,
  saveRefined,
} from '../../profile/serializer.ts';
import { formatProfileEvaluationLines } from '../../services/jobEvaluationText.ts';
import {
  applyConsultantFindingsToProfile,
  applyDirectEdit,
  applyRefinements,
  computeRefinementDiff,
  generateRefinementQuestions,
  polishProfile,
  sniffReduceAiTellsProfile,
} from '../../services/refine.ts';
import {
  listGlobalRefinementHistory,
  restoreGlobalRefinedSnapshot,
} from '../../services/refinementHistory.ts';
import { fileExists } from '../../utils/fs.ts';
import {
  type CheckboxItem,
  CheckboxList,
  ConfirmPrompt,
  DiffView,
  MultilineInput,
  ScrollView,
  SelectList,
  Spinner,
  TextInput,
  TextViewport,
} from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import {
  panelContentViewportRows,
  panelFramedTextWidth,
  panelInnerWidth,
} from '../panelContentWidth.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';
import { linesToWrappedRows, wrappedScrollMax } from '../utils/wrapTextRows.ts';

function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

function userEditSourced(value: string): Sourced<string> {
  const now = new Date().toISOString();
  return { value, source: { kind: 'user-edit', editedAt: now } };
}

function truncateForPanel(s: string, maxLen: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

type Phase =
  | { k: 'loading' }
  | { k: 'no-source'; msg: string }
  | { k: 'first-refine-menu' }
  | { k: 'has-refined-menu'; syncPrompt: boolean }
  | { k: 'syncing-md' }
  | { k: 'gen-questions' }
  | { k: 'qa'; questions: RefinementQuestion[]; index: number }
  | { k: 'apply' }
  | {
      k: 'diff';
      original: Profile;
      proposed: Profile;
      diffSaveMode?: 'qa' | 'keep-session';
      keepSessionReason?: RefinementSaveReason;
    }
  | {
      k: 'diff-edit-summary';
      original: Profile;
      proposed: Profile;
      diffSaveMode?: 'qa' | 'keep-session';
      keepSessionReason?: RefinementSaveReason;
    }
  | { k: 'refinement-history-list'; warnings: string[]; entries: RefinementHistoryListEntry[] }
  | {
      k: 'refinement-history-confirm';
      entry: RefinementHistoryListEntry;
      list: { entries: RefinementHistoryListEntry[]; warnings: string[] };
    }
  | { k: 'polish-pick' }
  | { k: 'polish-run'; sections: string[] }
  | { k: 'ai-sniff-run' }
  | { k: 'direct-edit-input' }
  | { k: 'direct-edit-run'; instructions: string }
  | { k: 'consultant-run' }
  | {
      k: 'consultant-view';
      evaluation: ProfileEvaluation;
      previewLines: string[];
      scroll: number;
    }
  | { k: 'consultant-pick' }
  | { k: 'consultant-questions-run' }
  | {
      k: 'consultant-feedback-qa';
      findings: ConsultantFinding[];
      questions: FeedbackQuestion[];
      index: number;
    }
  | { k: 'consultant-apply' }
  | { k: 'saving' }
  | { k: 'done'; note: string }
  | {
      k: 'err';
      msg: string;
      retryKind:
        | 'gen-questions'
        | 'apply'
        | 'save'
        | 'sync'
        | 'polish'
        | 'ai-sniff'
        | 'direct-edit'
        | 'consultant';
    };

export interface RefineScreenProps {
  profileDir: string;
}

export function RefineScreen({ profileDir }: RefineScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { activeScreen, focusTarget, inTextInput } = useAppState();
  const { createController, releaseController } = useOperationAbort();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [source, setSource] = useState<Profile | null>(null);
  const [questions, setQuestions] = useState<RefinementQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerDraft, setAnswerDraft] = useState('');
  /** When true, ↑↓ moves the question list; Shift+Tab from answer field toggles this on. */
  const [qaListFocus, setQaListFocus] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [diffSelectIdx, setDiffSelectIdx] = useState(0);
  const [summaryTweakDraft, setSummaryTweakDraft] = useState('');
  const [apiFailureStreak, setApiFailureStreak] = useState(0);
  const [errMenuIdx, setErrMenuIdx] = useState(0);
  const persistCtxRef = useRef<{
    profile: Profile;
    qs: RefinementQuestion[];
    ans: Record<string, string>;
  } | null>(null);
  const persistKeepRef = useRef<Profile | null>(null);
  const persistKeepReasonRef = useRef<RefinementSaveReason>('unspecified');
  const lastPolishSectionsRef = useRef<string[]>([]);
  const lastDirectInstructionsRef = useRef('');
  const [directEditDraft, setDirectEditDraft] = useState('');
  const [historyMenuIdx, setHistoryMenuIdx] = useState(0);
  const [polishMenuIdx, setPolishMenuIdx] = useState(0);
  const [consultantMenuIdx, setConsultantMenuIdx] = useState(0);
  const consultantWorkRef = useRef<{ base: Profile; evaluation: ProfileEvaluation } | null>(null);
  const consultantPendingFindingsRef = useRef<ConsultantFinding[] | null>(null);
  /** Last findings passed into enrich flow (subset or all); used for error retry after fetch fails. */
  const consultantEnrichFindingsRef = useRef<ConsultantFinding[] | null>(null);
  const consultantFbAnswersRef = useRef(new Map<number, string>());
  const [consultantFbDraft, setConsultantFbDraft] = useState('');
  const [consultantCheckboxItems, setConsultantCheckboxItems] = useState<
    Array<CheckboxItem<string>>
  >([]);
  const [consultantPickFocusIdx, setConsultantPickFocusIdx] = useState(0);
  const [cols, rows] = useTerminalSize();
  const panelW = panelInnerWidth(cols);
  const textW = panelFramedTextWidth(cols);
  const consultantScrollH = panelContentViewportRows(rows, 14);
  const directEditViewportH = panelContentViewportRows(rows, 12);

  const active = activeScreen === 'refine' && focusTarget === 'content';

  useRegisterBlockingUi(active && (phase.k === 'err' || phase.k === 'refinement-history-confirm'));

  const goBackToRefineHub = useCallback(() => {
    void (async () => {
      const refined = await fileExists(refinedJsonPath(profileDir));
      if (!refined) {
        setPhase({ k: 'first-refine-menu' });
        return;
      }
      const mdNewer = await isMdNewerThanJson(
        refinedMdPath(profileDir),
        refinedJsonPath(profileDir),
      );
      setPhase({ k: 'has-refined-menu', syncPrompt: mdNewer });
    })();
  }, [profileDir]);

  const restoreConsultantView = useCallback(() => {
    const w = consultantWorkRef.current;
    if (!w) {
      void goBackToRefineHub();
      return;
    }
    setConsultantMenuIdx(0);
    setConsultantFbDraft('');
    setPhase({
      k: 'consultant-view',
      evaluation: w.evaluation,
      previewLines: formatProfileEvaluationLines(w.evaluation),
      scroll: 0,
    });
  }, [goBackToRefineHub]);

  const openManualSections = useCallback(() => {
    dispatch({ type: 'SET_PROFILE_EDITOR_RETURN_TO', screen: 'refine' });
    navigate('profile');
  }, [dispatch, navigate]);

  useEffect(() => {
    if (phase.k === 'diff') {
      setDiffSelectIdx(0);
    }
    if (phase.k === 'refinement-history-list') {
      setHistoryMenuIdx(0);
    }
    if (phase.k !== 'qa') {
      setQaListFocus(false);
    }
  }, [phase.k]);

  useInput(
    (_input, key) => {
      if (!active || phase.k !== 'diff-edit-summary' || !inTextInput) {
        return;
      }
      if (key.escape) {
        setPhase({
          k: 'diff',
          original: phase.original,
          proposed: phase.proposed,
          diffSaveMode: phase.diffSaveMode,
          keepSessionReason: phase.keepSessionReason,
        });
      }
    },
    { isActive: active && phase.k === 'diff-edit-summary' },
  );

  useInput(
    (_input, key) => {
      if (!active) {
        return;
      }
      if (key.escape && phase.k === 'direct-edit-input') {
        setDirectEditDraft('');
        goBackToRefineHub();
        return;
      }
      if (inTextInput) {
        return;
      }
      if (key.escape && phase.k === 'consultant-pick') {
        restoreConsultantView();
        return;
      }
      if (key.escape && (phase.k === 'polish-pick' || phase.k === 'consultant-view')) {
        if (phase.k === 'consultant-view') {
          consultantWorkRef.current = null;
          consultantPendingFindingsRef.current = null;
          consultantEnrichFindingsRef.current = null;
        }
        goBackToRefineHub();
      }
    },
    {
      isActive:
        active &&
        (phase.k === 'polish-pick' ||
          phase.k === 'direct-edit-input' ||
          phase.k === 'consultant-view' ||
          phase.k === 'consultant-pick'),
    },
  );

  useInput(
    (_input, key) => {
      if (!active || phase.k !== 'qa' || !key.escape) {
        return;
      }
      setAnswerDraft('');
      setQaListFocus(false);
      goBackToRefineHub();
    },
    { isActive: active && phase.k === 'qa' },
  );

  useInput(
    (_input, key) => {
      if (!active || phase.k !== 'qa') {
        return;
      }
      if (key.shift && key.tab) {
        if (qaListFocus) {
          setQaListFocus(false);
        } else {
          setQaListFocus(true);
        }
      }
    },
    { isActive: active && phase.k === 'qa' },
  );

  useInput(
    (_input, key) => {
      if (!active || phase.k !== 'consultant-feedback-qa' || !key.escape) {
        return;
      }
      setConsultantFbDraft('');
      restoreConsultantView();
    },
    { isActive: active && phase.k === 'consultant-feedback-qa' },
  );

  useInput(
    (_input, key) => {
      if (!active || phase.k !== 'consultant-view' || inTextInput) {
        return;
      }
      const maxScroll = wrappedScrollMax(phase.previewLines, consultantScrollH, textW);
      const step = Math.max(1, consultantScrollH - 1);
      if (key.pageUp) {
        setPhase({
          ...phase,
          scroll: Math.max(0, phase.scroll - step),
        });
      }
      if (key.pageDown) {
        setPhase({
          ...phase,
          scroll: Math.min(maxScroll, phase.scroll + step),
        });
      }
    },
    { isActive: active && phase.k === 'consultant-view' },
  );

  const persistRefined = useCallback(
    async (profile: Profile, qs: RefinementQuestion[], ans: Record<string, string>) => {
      persistCtxRef.current = { profile, qs, ans };
      persistKeepRef.current = null;
      setPhase({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const sourceHash = await hashSource(profileDir);
        const session: RefinementSession = {
          conductedAt: new Date().toISOString(),
          sourceHash,
          questions: qs,
          answers: ans,
        };
        await saveRefined({ profile, session }, profileDir, { reason: 'qa-save' });
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        setPhase({ k: 'done', note: 'Refinements saved to refined.json / refined.md' });
      } catch (e) {
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'save',
        });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  const persistRefinedKeepSession = useCallback(
    async (profile: Profile, reason: RefinementSaveReason) => {
      persistKeepRef.current = profile;
      persistKeepReasonRef.current = reason;
      persistCtxRef.current = null;
      setPhase({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadRefined(profileDir);
        await saveRefined({ profile, session: existing.session }, profileDir, { reason });
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        consultantWorkRef.current = null;
        consultantPendingFindingsRef.current = null;
        consultantEnrichFindingsRef.current = null;
        setPhase({
          k: 'done',
          note: 'Updated refined.json / refined.md (Q&A session unchanged).',
        });
      } catch (e) {
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'save',
        });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  const syncRefinedFromMarkdown = useCallback(async () => {
    setPhase({ k: 'syncing-md' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const existing = await loadRefined(profileDir);
      const updatedProfile = await markdownToProfile(refinedMdPath(profileDir), existing.profile);
      await saveRefined({ profile: updatedProfile, session: existing.session }, profileDir, {
        reason: 'md-sync',
      });
      setPhase({ k: 'has-refined-menu', syncPrompt: false });
    } catch (e) {
      setErrMenuIdx(0);
      setPhase({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'sync',
      });
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, profileDir]);

  const openRefinementHistory = useCallback(async () => {
    try {
      const { entries, warnings } = await listGlobalRefinementHistory(profileDir);
      setPhase({ k: 'refinement-history-list', entries, warnings });
    } catch (e) {
      setErrMenuIdx(0);
      setPhase({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'save',
      });
    }
  }, [profileDir]);

  const runRestoreFromHistory = useCallback(
    async (entry: RefinementHistoryListEntry) => {
      setPhase({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        await restoreGlobalRefinedSnapshot(profileDir, entry.id);
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setPhase({ k: 'done', note: `Restored refinement snapshot ${entry.id}.` });
      } catch (e) {
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'save',
        });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  const beginQaFlow = useCallback(async () => {
    if (!source) {
      return;
    }
    const ac = createController();
    setPhase({ k: 'gen-questions' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const qs = await generateRefinementQuestions(source, ac.signal);
      setQuestions(qs);
      if (qs.length === 0) {
        const sourceHash = await hashSource(profileDir);
        const session: RefinementSession = {
          conductedAt: new Date().toISOString(),
          sourceHash,
          questions: [],
          answers: {},
        };
        await saveRefined({ profile: source, session }, profileDir, { reason: 'qa-save' });
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        setPhase({ k: 'done', note: 'No gaps found — saved source as refined (no edits).' });
        return;
      }
      setAnswers({});
      setAnswerDraft('');
      setQaListFocus(false);
      setApiFailureStreak(0);
      setPhase({ k: 'qa', questions: qs, index: 0 });
    } catch (e) {
      if (isUserAbort(e)) {
        goBackToRefineHub();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setPhase({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'gen-questions',
      });
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [createController, dispatch, goBackToRefineHub, profileDir, releaseController, source]);

  useEffect(() => {
    void (async () => {
      try {
        const src = await loadSource(profileDir);
        setSource(src);
        const refined = await fileExists(refinedJsonPath(profileDir));
        if (refined) {
          const mdNewer = await isMdNewerThanJson(
            refinedMdPath(profileDir),
            refinedJsonPath(profileDir),
          );
          setPhase({ k: 'has-refined-menu', syncPrompt: mdNewer });
        } else {
          setMenuIdx(0);
          setPhase({ k: 'first-refine-menu' });
        }
      } catch (e) {
        setPhase({ k: 'no-source', msg: (e as Error).message });
      }
    })();
  }, [profileDir]);

  const runApply = useCallback(
    async (answersSnapshot?: Record<string, string>) => {
      if (!source) {
        return;
      }
      const ans = answersSnapshot ?? answers;
      const ac = createController();
      setPhase({ k: 'apply' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const proposed = await applyRefinements(source, questions, ans, ac.signal);
        const blocks = computeRefinementDiff(source, proposed);
        if (blocks.length === 0) {
          await persistRefined(proposed, questions, ans);
          return;
        }
        setApiFailureStreak(0);
        setPhase({ k: 'diff', original: source, proposed, diffSaveMode: 'qa' });
      } catch (e) {
        if (isUserAbort(e)) {
          setQaListFocus(false);
          setPhase({ k: 'qa', questions, index: Math.max(0, questions.length - 1) });
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'apply',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [answers, createController, dispatch, persistRefined, questions, releaseController, source],
  );

  const runPolish = useCallback(
    async (sections: string[]) => {
      lastPolishSectionsRef.current = sections;
      const ac = createController();
      setPhase({ k: 'polish-run', sections });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadRefined(profileDir);
        const base = cloneProfile(existing.profile);
        let proposed = base;
        for await (const ev of polishProfile(base, { sections }, ac.signal)) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          await persistRefinedKeepSession(proposed, 'polish');
          return;
        }
        setPhase({
          k: 'diff',
          original: base,
          proposed,
          diffSaveMode: 'keep-session',
          keepSessionReason: 'polish',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          goBackToRefineHub();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'polish',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [
      createController,
      dispatch,
      goBackToRefineHub,
      persistRefinedKeepSession,
      profileDir,
      releaseController,
    ],
  );

  const runAiSniff = useCallback(async () => {
    const ac = createController();
    setPhase({ k: 'ai-sniff-run' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const existing = await loadRefined(profileDir);
      const base = cloneProfile(existing.profile);
      let proposed = base;
      for await (const ev of sniffReduceAiTellsProfile(base, ac.signal)) {
        if (ev.type === 'done') {
          proposed = ev.result;
        }
      }
      const blocks = computeRefinementDiff(base, proposed);
      setApiFailureStreak(0);
      if (blocks.length === 0) {
        await persistRefinedKeepSession(proposed, 'ai-sniff');
        return;
      }
      setPhase({
        k: 'diff',
        original: base,
        proposed,
        diffSaveMode: 'keep-session',
        keepSessionReason: 'ai-sniff',
      });
    } catch (e) {
      if (isUserAbort(e)) {
        goBackToRefineHub();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setPhase({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'ai-sniff',
      });
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [
    createController,
    dispatch,
    goBackToRefineHub,
    persistRefinedKeepSession,
    profileDir,
    releaseController,
  ]);

  const runDirectEdit = useCallback(
    async (instructions: string) => {
      lastDirectInstructionsRef.current = instructions;
      const ac = createController();
      setPhase({ k: 'direct-edit-run', instructions });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadRefined(profileDir);
        const base = cloneProfile(existing.profile);
        let proposed = base;
        for await (const ev of applyDirectEdit(base, instructions, ac.signal)) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          await persistRefinedKeepSession(proposed, 'direct-edit');
          return;
        }
        setPhase({
          k: 'diff',
          original: base,
          proposed,
          diffSaveMode: 'keep-session',
          keepSessionReason: 'direct-edit',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          goBackToRefineHub();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'direct-edit',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [
      createController,
      dispatch,
      goBackToRefineHub,
      persistRefinedKeepSession,
      profileDir,
      releaseController,
    ],
  );

  const runConsultantReview = useCallback(async () => {
    consultantWorkRef.current = null;
    consultantPendingFindingsRef.current = null;
    consultantEnrichFindingsRef.current = null;
    const ac = createController();
    setPhase({ k: 'consultant-run' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const existing = await loadRefined(profileDir);
      const base = cloneProfile(existing.profile);
      const evaluation = await evaluateProfile(base);
      const previewLines = formatProfileEvaluationLines(evaluation);
      consultantWorkRef.current = { base, evaluation };
      setConsultantMenuIdx(0);
      setPhase({
        k: 'consultant-view',
        evaluation,
        previewLines,
        scroll: 0,
      });
      setApiFailureStreak(0);
    } catch (e) {
      if (isUserAbort(e)) {
        goBackToRefineHub();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setPhase({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'consultant',
      });
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [createController, dispatch, goBackToRefineHub, profileDir, releaseController]);

  const runConsultantApplyWithFindings = useCallback(
    async (findings: ConsultantFinding[]) => {
      const work = consultantWorkRef.current;
      if (!work || findings.length === 0) {
        return;
      }
      const { base, evaluation } = work;
      consultantPendingFindingsRef.current = findings;
      const ac = createController();
      setPhase({ k: 'consultant-apply' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const proposed = await applyConsultantFindingsToProfile(base, findings, ac.signal);
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          consultantPendingFindingsRef.current = null;
          await persistRefinedKeepSession(proposed, 'consultant');
          return;
        }
        setPhase({
          k: 'diff',
          original: base,
          proposed,
          diffSaveMode: 'keep-session',
          keepSessionReason: 'consultant',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          setConsultantMenuIdx(0);
          setPhase({
            k: 'consultant-view',
            evaluation,
            previewLines: formatProfileEvaluationLines(evaluation),
            scroll: 0,
          });
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'consultant',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, persistRefinedKeepSession, releaseController],
  );

  const runConsultantEnrichAndApply = useCallback(
    async (findings: ConsultantFinding[]) => {
      const work = consultantWorkRef.current;
      if (!work || findings.length === 0) {
        return;
      }
      consultantEnrichFindingsRef.current = findings;
      const ac = createController();
      setPhase({ k: 'consultant-questions-run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const profileText = profileToRefineText(work.base);
        const qs = await fetchConsultantFeedbackQuestions(findings, profileText, ac.signal);
        if (qs.length === 0) {
          dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
          releaseController(ac);
          await runConsultantApplyWithFindings(findings);
          return;
        }
        consultantFbAnswersRef.current = new Map();
        setConsultantFbDraft('');
        setPhase({
          k: 'consultant-feedback-qa',
          findings,
          questions: qs,
          index: 0,
        });
      } catch (e) {
        if (isUserAbort(e)) {
          restoreConsultantView();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setPhase({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'consultant',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [
      createController,
      dispatch,
      releaseController,
      restoreConsultantView,
      runConsultantApplyWithFindings,
    ],
  );

  const refineFooterHint = useMemo(() => {
    const sb = ' · Tab sidebar';
    switch (phase.k) {
      case 'loading':
        return `Refine · loading…${sb}`;
      case 'no-source':
        return `Refine · import a profile first${sb}`;
      case 'polish-pick':
        return `Refine · ↑↓ Enter · Esc back to refined menu${sb}`;
      case 'direct-edit-input':
        return `Refine · Ctrl+D or Ctrl+S submit · PgUp/PgDn · ↑↓ scroll · Esc menu${sb}`;
      case 'first-refine-menu':
        return `Refine · ↑↓ Enter · Q&A pass or manual section edit${sb}`;
      case 'has-refined-menu':
        return phase.syncPrompt
          ? `Refine · Enter confirm md sync · Esc cancel${sb}`
          : `Refine · ↑↓ Enter · Q&A, polish, AI sniff, consultant, manual edit, direct edit${sb}`;
      case 'consultant-view':
        return `Refine · PgUp/PgDn scroll text · ↑↓ actions · Enter · Esc menu${sb}`;
      case 'consultant-pick':
        return `Refine · Space toggle · Enter confirm · Esc back to review${sb}`;
      case 'consultant-feedback-qa':
        return `Refine · Enter submit answer (blank OK) · Esc back to review${sb}`;
      case 'gen-questions':
      case 'apply':
      case 'polish-run':
      case 'ai-sniff-run':
      case 'direct-edit-run':
      case 'consultant-run':
      case 'consultant-questions-run':
      case 'consultant-apply':
      case 'syncing-md':
      case 'saving':
        return `Refine · working…${sb}`;
      case 'qa':
        return qaListFocus
          ? `Refine · ↑↓ questions · Enter answer field · Shift+Tab · Esc menu${sb}`
          : `Refine · Shift+Tab question list · Enter next/submit · Esc menu${sb}`;
      case 'diff':
        return `Refine · ↑↓ choose action · Enter confirm${sb}`;
      case 'diff-edit-summary':
        return `Refine · Enter apply summary · Esc cancel (keep prior)${sb}`;
      case 'done':
        return `Refine · done · Tab sidebar${sb}`;
      case 'err':
        return `Refine · ↑↓ Enter · retry / settings / back${sb}`;
      case 'refinement-history-list':
        return `Refine · ↑↓ Enter · pick snapshot or back${sb}`;
      case 'refinement-history-confirm':
        return `Refine · y/n · confirm restore${sb}`;
      default:
        return `Refine${sb}`;
    }
  }, [phase, qaListFocus]);

  useRegisterPanelFooterHint(refineFooterHint);

  if (phase.k === 'loading') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Loading profile…" />
      </Box>
    );
  }

  if (phase.k === 'no-source') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Text color="red">{phase.msg}</Text>
      </Box>
    );
  }

  if (phase.k === 'first-refine-menu') {
    const firstItems = [
      { value: 'qa', label: 'Run Q&A from source (first refinement pass)' },
      { value: 'edit', label: 'Edit profile sections (manual — source.json)' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Text>
          No refined.json yet. Run the Q&A pass to build refined data, or edit the imported source
          manually first.
        </Text>
        <Box marginTop={1}>
          <SelectList
            items={firstItems}
            selectedIndex={menuIdx}
            onChange={(i) => setMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'qa') {
                void beginQaFlow();
                return;
              }
              openManualSections();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'polish-pick') {
    const polishItems = [
      { value: 'all', label: 'Polish: summary + experience + skills' },
      { value: 'summary', label: 'Polish: summary only' },
      { value: 'experience', label: 'Polish: experience bullets (all roles)' },
      { value: 'skills', label: 'Polish: skills only' },
      { value: 'back', label: '← Back' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Refine — polish</Text>
        <Box marginTop={1}>
          <SelectList
            items={polishItems}
            selectedIndex={polishMenuIdx}
            onChange={(i) => setPolishMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'back') {
                goBackToRefineHub();
                return;
              }
              const sections =
                item.value === 'all'
                  ? (['summary', 'experience', 'skills'] as const)
                  : item.value === 'summary'
                    ? ['summary']
                    : item.value === 'experience'
                      ? ['experience']
                      : ['skills'];
              void runPolish([...sections]);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'polish-run') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Polishing profile…" />
      </Box>
    );
  }

  if (phase.k === 'ai-sniff-run') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Running AI sniff pass (humanizing phrasing)…" />
      </Box>
    );
  }

  if (phase.k === 'direct-edit-input') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Refine — direct edit</Text>
        <Box marginTop={1} flexGrow={1}>
          <MultilineInput
            value={directEditDraft}
            onChange={setDirectEditDraft}
            focus={active}
            width={textW}
            height={directEditViewportH}
            onSubmit={(text) => {
              const t = text.trim();
              if (!t) {
                return;
              }
              void runDirectEdit(t);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'direct-edit-run') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Applying direct edit…" />
      </Box>
    );
  }

  if (phase.k === 'consultant-run') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Running hiring-manager review…" />
      </Box>
    );
  }

  if (phase.k === 'consultant-questions-run') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Checking which suggestions need details from you…" />
      </Box>
    );
  }

  if (phase.k === 'consultant-apply') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Applying consultant suggestions to profile…" />
      </Box>
    );
  }

  if (phase.k === 'consultant-feedback-qa') {
    const q = phase.questions[phase.index];
    const finding = q ? phase.findings[q.findingIndex] : undefined;
    if (!q || !finding) {
      return (
        <Box flexDirection="column">
          <Text bold>Refine</Text>
          <Spinner label="Applying consultant suggestions…" />
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text bold>
          Consultant follow-up {phase.index + 1}/{phase.questions.length}
        </Text>
        <Text dimColor>{finding.area}</Text>
        <Text dimColor>{finding.suggestion}</Text>
        <Box marginTop={1}>
          <Text>{q.question}</Text>
          <TextInput
            value={consultantFbDraft}
            onChange={setConsultantFbDraft}
            focus={active}
            onSubmit={(v) => {
              const trimmed = v.trim();
              if (trimmed) {
                consultantFbAnswersRef.current.set(q.findingIndex, trimmed);
              }
              setConsultantFbDraft('');
              if (phase.index + 1 >= phase.questions.length) {
                const merged = mergeConsultantFindingAnswers(
                  phase.findings,
                  new Map(consultantFbAnswersRef.current),
                );
                void runConsultantApplyWithFindings(merged);
              } else {
                setPhase({ ...phase, index: phase.index + 1 });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'consultant-pick') {
    return (
      <Box flexDirection="column">
        <Text bold>Professional consultant — choose suggestions</Text>
        <Text dimColor>
          Space toggles each item · Enter applies selected (at least one) · Esc back to review
        </Text>
        <Box marginTop={1}>
          {consultantCheckboxItems.length === 0 ? (
            <Text dimColor>No suggestions — Esc to go back.</Text>
          ) : (
            <CheckboxList
              items={consultantCheckboxItems}
              focusedIndex={consultantPickFocusIdx}
              onFocusChange={setConsultantPickFocusIdx}
              onItemsChange={setConsultantCheckboxItems}
              isActive={active}
              onConfirm={() => {
                const w = consultantWorkRef.current;
                if (!w) {
                  return;
                }
                const checkedIdx = consultantCheckboxItems
                  .filter((it) => it.checked)
                  .map((it) => Number.parseInt(it.value, 10))
                  .filter(
                    (i) => !Number.isNaN(i) && i >= 0 && i < w.evaluation.improvements.length,
                  );
                if (checkedIdx.length === 0) {
                  return;
                }
                checkedIdx.sort((a, b) => a - b);
                const selected = checkedIdx
                  .map((i) => w.evaluation.improvements[i])
                  .filter((f): f is ConsultantFinding => f != null);
                void runConsultantEnrichAndApply(selected);
              }}
            />
          )}
        </Box>
      </Box>
    );
  }

  if (phase.k === 'consultant-view') {
    const consultantRows = linesToWrappedRows(phase.previewLines, textW);
    const consultantItems = [
      ...(phase.evaluation.improvements.length > 0
        ? [
            {
              value: 'apply-all' as const,
              label: 'Apply all suggestions (follow-up questions if needed)',
            },
            {
              value: 'apply-pick' as const,
              label: 'Choose which suggestions to apply',
            },
          ]
        : []),
      { value: 'back' as const, label: '← Back to refined menu' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Professional consultant review</Text>
        <Text dimColor>
          Overall feedback on your refined profile (not job-specific). PgUp/PgDn scrolls the text;
          ↑↓ moves actions.
        </Text>
        <Box marginTop={1} flexGrow={1}>
          <TextViewport
            panelWidth={panelW}
            viewportHeight={consultantScrollH}
            scrollOffset={phase.scroll}
            totalRows={consultantRows.length}
            kind="Consultant review"
          >
            <ScrollView
              displayLines={consultantRows}
              height={consultantScrollH}
              scrollOffset={phase.scroll}
              padToWidth={textW}
            />
          </TextViewport>
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={consultantItems}
            selectedIndex={consultantMenuIdx}
            onChange={(i) => setConsultantMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'apply-all') {
                void runConsultantEnrichAndApply(phase.evaluation.improvements);
                return;
              }
              if (item.value === 'apply-pick') {
                const imps = phase.evaluation.improvements;
                setConsultantCheckboxItems(
                  imps.map((f, i) => ({
                    value: String(i),
                    label: truncateForPanel(`${f.area}: ${f.issue}`, Math.max(24, textW - 8)),
                    checked: true,
                  })),
                );
                setConsultantPickFocusIdx(0);
                setPhase({ k: 'consultant-pick' });
                return;
              }
              consultantWorkRef.current = null;
              consultantPendingFindingsRef.current = null;
              consultantEnrichFindingsRef.current = null;
              goBackToRefineHub();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'has-refined-menu') {
    const items = [
      { value: 'start', label: 'Run Q&A from source (new refinement pass)' },
      { value: 'polish', label: 'Polish sections (AI)' },
      {
        value: 'ai-sniff',
        label: 'AI sniff pass (reduce AI-looking phrasing)',
      },
      {
        value: 'consultant',
        label: 'Professional consultant review (hiring manager, whole profile)',
      },
      { value: 'edit', label: 'Edit profile sections (manual)' },
      { value: 'direct', label: 'Direct edit (instructions to Claude)' },
      { value: 'history', label: 'View / restore refinement history' },
    ];
    const syncPrompt = phase.syncPrompt;
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Text>
          You already have refined data. A new pass uses source.json and replaces refined.json after
          you accept the diff.
        </Text>
        {syncPrompt && (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
          >
            <Text color="yellow">
              refined.md is newer than refined.json (edited outside the TUI).
            </Text>
            <Box marginTop={1}>
              <ConfirmPrompt
                message="Reload refined.json from the edited markdown?"
                active={active && syncPrompt}
                onConfirm={() => {
                  void syncRefinedFromMarkdown();
                }}
                onCancel={() => {
                  goBackToRefineHub();
                }}
              />
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={items}
            selectedIndex={menuIdx}
            onChange={(i) => setMenuIdx(i)}
            isActive={active && !syncPrompt}
            onSubmit={(item) => {
              if (item.value === 'start') {
                void beginQaFlow();
                return;
              }
              if (item.value === 'polish') {
                setPolishMenuIdx(0);
                setPhase({ k: 'polish-pick' });
                return;
              }
              if (item.value === 'ai-sniff') {
                void runAiSniff();
                return;
              }
              if (item.value === 'consultant') {
                void runConsultantReview();
                return;
              }
              if (item.value === 'edit') {
                openManualSections();
                return;
              }
              if (item.value === 'direct') {
                setDirectEditDraft('');
                setPhase({ k: 'direct-edit-input' });
                return;
              }
              if (item.value === 'history') {
                void openRefinementHistory();
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'refinement-history-list') {
    const listItems = [
      ...phase.entries.map((e) => ({
        value: `snap:${e.id}`,
        label: `${e.id} · ${e.savedAt} · ${e.reason}`,
      })),
      { value: 'back', label: '← Back to refined menu' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Refinement history</Text>
        <Text dimColor>
          Snapshots are saved automatically when refined.json changes. Restore replaces current
          refined.json and refined.md; job PDF squeeze hints may reset.
        </Text>
        {phase.warnings.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {phase.warnings.map((w) => (
              <Text key={w} color="yellow">
                {w}
              </Text>
            ))}
          </Box>
        )}
        {phase.entries.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No snapshots yet (appears after the second save of refined data).</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={listItems}
            selectedIndex={historyMenuIdx}
            onChange={(i) => setHistoryMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'back') {
                void goBackToRefineHub();
                return;
              }
              const id = item.value.replace(/^snap:/, '');
              const entry = phase.entries.find((e) => e.id === id);
              if (!entry) {
                return;
              }
              setPhase({
                k: 'refinement-history-confirm',
                entry,
                list: { entries: phase.entries, warnings: phase.warnings },
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'refinement-history-confirm') {
    return (
      <Box flexDirection="column">
        <Text bold>Restore snapshot?</Text>
        <Text>
          id {phase.entry.id} · {phase.entry.savedAt} · {phase.entry.reason}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Your current refined profile will be snapshotted first. You can undo by restoring a
            newer entry.
          </Text>
        </Box>
        <Box marginTop={1}>
          <ConfirmPrompt
            message="Restore this snapshot?"
            active={active}
            onConfirm={() => {
              void runRestoreFromHistory(phase.entry);
            }}
            onCancel={() => {
              setPhase({
                k: 'refinement-history-list',
                entries: phase.list.entries,
                warnings: phase.list.warnings,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'syncing-md') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Syncing refined.json from refined.md…" />
      </Box>
    );
  }

  if (phase.k === 'gen-questions') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Generating questions…" />
      </Box>
    );
  }

  if (phase.k === 'qa') {
    const q = phase.questions[phase.index];
    if (!q) {
      return (
        <Box flexDirection="column">
          <Spinner label="Starting apply…" />
        </Box>
      );
    }
    const labelW = Math.max(16, textW - 16);
    const qaItems = phase.questions.map((qq, i) => ({
      value: String(i),
      label: `${i + 1}. ${truncateForPanel(qq.question, labelW)}${
        answers[qq.id]?.trim() ? ' (answered)' : ''
      }`,
    }));
    return (
      <Box flexDirection="column">
        <Text bold>Refine — Q&A from source</Text>
        <Text dimColor>
          {phase.questions.length} question{phase.questions.length === 1 ? '' : 's'} · Shift+Tab
          switches question list / answer field · In the list, ↑↓ move · Enter opens the answer
          field
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold={qaListFocus} dimColor={!qaListFocus}>
            Questions {qaListFocus ? '(focused)' : '(Shift+Tab)'}
          </Text>
          <SelectList
            items={qaItems}
            selectedIndex={phase.index}
            onChange={(i) => {
              if (phase.k !== 'qa') {
                return;
              }
              const oldQ = phase.questions[phase.index];
              const merged = { ...answers };
              if (oldQ) {
                merged[oldQ.id] = answerDraft.trim();
              }
              const newQ = phase.questions[i];
              setAnswers(merged);
              setAnswerDraft(newQ ? (merged[newQ.id] ?? '') : '');
              setPhase({ ...phase, index: i });
            }}
            isActive={active && qaListFocus}
            onSubmit={() => {
              setQaListFocus(false);
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Question {phase.index + 1}</Text>
          <Text dimColor>{q.context}</Text>
          <Text>{q.question}</Text>
          <TextInput
            value={answerDraft}
            onChange={setAnswerDraft}
            focus={active && !qaListFocus}
            onSubmit={(v) => {
              const next = { ...answers, [q.id]: v.trim() };
              setAnswers(next);
              if (phase.index + 1 >= phase.questions.length) {
                setAnswerDraft('');
                void runApply(next);
              } else {
                const ni = phase.index + 1;
                const nq = phase.questions[ni];
                setPhase({ ...phase, index: ni });
                setAnswerDraft(nq ? (next[nq.id] ?? '') : '');
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'apply') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Applying refinements…" />
      </Box>
    );
  }

  if (phase.k === 'diff') {
    const blocks = computeRefinementDiff(phase.original, phase.proposed);
    const diffItems = [
      { value: 'accept', label: 'Accept and save refined profile' },
      { value: 'edit-summary', label: 'Edit proposed summary (then review diff again)' },
      { value: 'discard', label: 'Discard — keep refined.json unchanged' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Review changes</Text>
        <DiffView blocks={blocks} />
        <Box marginTop={1}>
          <SelectList
            items={diffItems}
            selectedIndex={diffSelectIdx}
            onChange={(i) => setDiffSelectIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'accept') {
                if (phase.diffSaveMode === 'keep-session') {
                  void persistRefinedKeepSession(
                    phase.proposed,
                    phase.keepSessionReason ?? 'unspecified',
                  );
                } else {
                  void persistRefined(phase.proposed, questions, answers);
                }
              } else if (item.value === 'discard') {
                setPhase({ k: 'done', note: 'Discarded — refined.json unchanged.' });
              } else if (item.value === 'edit-summary') {
                setSummaryTweakDraft(phase.proposed.summary?.value ?? '');
                setPhase({
                  k: 'diff-edit-summary',
                  original: phase.original,
                  proposed: phase.proposed,
                  diffSaveMode: phase.diffSaveMode,
                  keepSessionReason: phase.keepSessionReason,
                });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'diff-edit-summary') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine — edit proposed summary</Text>
        <Box marginTop={1}>
          <TextInput
            value={summaryTweakDraft}
            onChange={setSummaryTweakDraft}
            focus={active}
            onSubmit={() => {
              const next = cloneProfile(phase.proposed);
              const t = summaryTweakDraft.trim();
              if (t) {
                next.summary = userEditSourced(t);
              } else {
                delete next.summary;
              }
              setPhase({
                k: 'diff',
                original: phase.original,
                proposed: next,
                diffSaveMode: phase.diffSaveMode ?? 'qa',
                keepSessionReason: phase.keepSessionReason,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'saving') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Spinner label="Saving…" />
      </Box>
    );
  }

  if (phase.k === 'done') {
    return (
      <Box flexDirection="column">
        <Text bold color="green">
          {phase.note}
        </Text>
      </Box>
    );
  }

  if (phase.k === 'err') {
    const showSettings = apiFailureStreak >= 3;
    const errItems = [
      { value: 'retry' as const, label: 'Retry' },
      ...(showSettings
        ? [{ value: 'settings' as const, label: 'Check Settings (API key / provider)' }]
        : []),
      {
        value: 'back' as const,
        label:
          phase.retryKind === 'apply'
            ? 'Back to last question'
            : phase.retryKind === 'consultant' && consultantWorkRef.current
              ? 'Back to consultant review'
              : 'Back to refined menu',
      },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Refine — error</Text>
        <Text color="red">{phase.msg}</Text>
        {showSettings && (
          <Box marginTop={1}>
            <Text dimColor>
              Several failures in a row — verify your API key and provider in Settings.
            </Text>
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
                setApiFailureStreak(0);
                navigate('settings');
                dispatch({ type: 'SET_FOCUS', target: 'content' });
                return;
              }
              if (item.value === 'back') {
                setApiFailureStreak(0);
                if (phase.retryKind === 'apply') {
                  setQaListFocus(false);
                  setPhase({ k: 'qa', questions, index: Math.max(0, questions.length - 1) });
                  return;
                }
                if (phase.retryKind === 'consultant') {
                  const w = consultantWorkRef.current;
                  if (w) {
                    setConsultantMenuIdx(0);
                    setPhase({
                      k: 'consultant-view',
                      evaluation: w.evaluation,
                      previewLines: formatProfileEvaluationLines(w.evaluation),
                      scroll: 0,
                    });
                    return;
                  }
                }
                goBackToRefineHub();
                return;
              }
              if (item.value === 'retry') {
                setErrMenuIdx(0);
                if (phase.retryKind === 'gen-questions') {
                  void beginQaFlow();
                } else if (phase.retryKind === 'apply') {
                  void runApply();
                } else if (phase.retryKind === 'save') {
                  const kp = persistKeepRef.current;
                  if (kp) {
                    void persistRefinedKeepSession(kp, persistKeepReasonRef.current);
                  } else {
                    const ctx = persistCtxRef.current;
                    if (ctx) {
                      void persistRefined(ctx.profile, ctx.qs, ctx.ans);
                    }
                  }
                } else if (phase.retryKind === 'sync') {
                  void syncRefinedFromMarkdown();
                } else if (phase.retryKind === 'polish') {
                  void runPolish(lastPolishSectionsRef.current);
                } else if (phase.retryKind === 'ai-sniff') {
                  void runAiSniff();
                } else if (phase.retryKind === 'consultant') {
                  const w = consultantWorkRef.current;
                  const pending = consultantPendingFindingsRef.current;
                  const enrichStash = consultantEnrichFindingsRef.current;
                  if (w && pending && pending.length > 0) {
                    void runConsultantApplyWithFindings(pending);
                  } else if (w && enrichStash && enrichStash.length > 0) {
                    void runConsultantEnrichAndApply(enrichStash);
                  } else if (w && w.evaluation.improvements.length > 0) {
                    void runConsultantEnrichAndApply(w.evaluation.improvements);
                  } else {
                    void runConsultantReview();
                  }
                } else {
                  void runDirectEdit(lastDirectInstructionsRef.current);
                }
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  return null;
}
