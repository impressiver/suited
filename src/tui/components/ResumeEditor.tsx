import { Box, type DOMElement, measureElement, Text, useInput } from 'ink';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ConsultantFinding,
  FeedbackQuestion,
  ProfileEvaluation,
} from '../../claude/prompts/consultant.ts';
import { profileToRefineText } from '../../claude/prompts/refine.ts';
import {
  buildExperiencePositionConsultantLabel,
  evaluateProfile,
  fetchConsultantFeedbackQuestions,
  mergeConsultantFindingAnswers,
} from '../../generate/consultant.ts';
import {
  markdownToProfile,
  parseDisplayMarkdownStringToProfile,
  profileMarkdownContent,
  stripHtmlCommentsFromProfileMarkdown,
} from '../../profile/markdown.ts';
import type { RefinementHistoryListEntry } from '../../profile/refinementHistory.ts';
import type {
  Profile,
  RefinementQuestion,
  RefinementSession,
  Sourced,
} from '../../profile/schema.ts';
import type { RefinementSaveReason } from '../../profile/serializer.ts';
import { hashSource, isMdNewerThanJson, loadActiveProfile, loadSource } from '../../profile/serializer.ts';
import { formatProfileEvaluationLines } from '../../services/jobEvaluationText.ts';
import {
  applyConsultantFindingsToProfile,
  applyDirectEdit,
  applyRefinements,
  computeRefinementDiff,
  evaluateProfileSection,
  generateRefinementQuestions,
  polishProfile,
  sniffReduceAiTellsProfile,
} from '../../services/refine.ts';
import {
  listGlobalRefinementHistory,
  restoreGlobalRefinedSnapshot,
} from '../../services/refinementHistory.ts';
import { validateProfile } from '../../services/validate.ts';
import { EditorHint } from './EditorHint.tsx';
import {
  type CheckboxItem,
  CheckboxList,
  ConfirmPrompt,
  DiffView,
  FreeCursorMultilineInput,
  MultilineInput,
  ScrollView,
  SelectList,
  Spinner,
  TextInput,
  TextViewport,
} from './shared/index.ts';
import { getDashboardVariant } from '../dashboardVariant.ts';
import { hasApiKey } from '../env.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { useTerminalSgrMouse } from '../hooks/useTerminalSgrMouse.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import {
  panelContentViewportRows,
  panelFramedTextWidth,
  panelInnerWidth,
} from '../panelContentWidth.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import {
  loadRefinedTuiState,
  refinedJsonPathForTarget,
  refinedMdPathForTarget,
  type RefineTuiLoadedState,
} from '../refinedPersistenceContext.ts';
import { REFINE_SECTION_MENU_ROWS, refineConsultantSectionRows } from '../refineSectionMenu.ts';
import { readResumeScroll, rememberResumeScroll } from '../resumeScrollMemory.ts';
import {
  buildResumeSectionIndex,
  buildSectionScrollRowMap,
  experiencePositionShortLabel,
  findDisplayRowForSection,
  isRefinableSectionId,
  matchSectionEntryForHeadingLine,
  type ResumeSectionEntry,
  type ResumeSectionId,
  resumeExperiencePositionIdForEditorView,
  resumeSectionIdAtMarkdownOffset,
} from '../resumeSectionIndex.ts';
import { saveRefinedForPersistenceTarget } from '../saveRefinedForPersistenceTarget.ts';
import { useAppDispatch, useAppState } from '../store.tsx';
import { offsetAtLineCol } from '../textBufferCursor.ts';
import { SCREEN_ORDER } from '../types.ts';
import { wrappedMarkdownHintRows } from '../utils/markdownDisplayHints.tsx';
import { parseSgrMouseEvent } from '../utils/sgrMouseWheel.ts';
import { linesToWrappedRows, splitLinesForWrap, wrappedScrollMax } from '../utils/wrapTextRows.ts';
import { fileExists } from '../../utils/fs.ts';
import { useValidationState } from '../validationContext.tsx';
import { useResumeEditorContext } from './ResumeEditorContext.tsx';
import { type JdPaneMode, JdPane } from './JdPane.tsx';

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

/** Rows consumed by `FreeCursorMultilineInput`'s `TextViewport` below the section strip (top+bottom border + dim scroll hint). */
const RESUME_EDITOR_VIEWPORT_CHROME_ROWS = 3;

/**
 * Rows for the section strip block above the editor: one hint line, optional parse error line,
 * and the inner box's `marginBottom={1}` gap before the markdown frame.
 */
function resumeEditorSectionBlockRows(parseErr: string | null): number {
  return 2 + (parseErr != null ? 1 : 0);
}

function polishSectionIdsForResumeSection(id: ResumeSectionId | null): string[] | null {
  if (id === 'education') {
    return null;
  }
  if (id === 'summary') {
    return ['summary'];
  }
  if (id === 'experience') {
    return ['experience'];
  }
  if (id === 'skills') {
    return ['skills'];
  }
  return ['summary', 'experience', 'skills'];
}

// ---------------------------------------------------------------------------
// Overlay state machine type
// ---------------------------------------------------------------------------

type EditorOverlay =
  | null // no overlay -- normal editor
  | { k: 'gen-questions' }
  | { k: 'qa'; questions: RefinementQuestion[]; index: number }
  | { k: 'qa-apply' }
  | { k: 'polish-pick' }
  | { k: 'polish-run'; sections: string[] }
  | { k: 'sniff-run' }
  | { k: 'direct-edit-input' }
  | { k: 'direct-edit-run'; instructions: string }
  | { k: 'consultant-run' }
  | { k: 'consultant-section-run' }
  | {
      k: 'consultant-view';
      evaluation: ProfileEvaluation;
      previewLines: string[];
      scroll: number;
      sectionScopeLabel?: string;
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
  | {
      k: 'diff';
      original: Profile;
      proposed: Profile;
      saveMode?: 'qa' | 'keep-session';
      keepSessionReason?: RefinementSaveReason;
    }
  | {
      k: 'diff-edit-summary';
      original: Profile;
      proposed: Profile;
      saveMode?: 'qa' | 'keep-session';
      keepSessionReason?: RefinementSaveReason;
    }
  | { k: 'history-list'; warnings: string[]; entries: RefinementHistoryListEntry[] }
  | {
      k: 'history-confirm';
      entry: RefinementHistoryListEntry;
      list: { entries: RefinementHistoryListEntry[]; warnings: string[] };
    }
  | { k: 'syncing-md' }
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
        | 'consultant'
        | 'consultant-section';
    };

export interface ResumeEditorProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
  /** Re-load snapshot from disk (e.g. health retry). */
  onRefreshSnapshot?: () => void;
  /** Callback when selected section changes */
  onSectionChange?: (section: string | null) => void;
}

export function ResumeEditor({
  snapshot,
  profileDir,
  onRefreshSnapshot,
  onSectionChange,
}: ResumeEditorProps) {
  const { persistenceTarget, onRequestClose, mode, jobDescription, jobId } = useResumeEditorContext();
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { activeScreen, inTextInput, paletteOpen, editorCommand } = useAppState();
  const persistenceTargetRef = useRef(persistenceTarget);
  persistenceTargetRef.current = persistenceTarget;
  const { createController, releaseController } = useOperationAbort();
  const panelActive =
    activeScreen === 'editor' || activeScreen === 'jobs';
  const [termCols, termRows] = useTerminalSize();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineIdx, setOutlineIdx] = useState(0);
  const [headingMenuEntry, setHeadingMenuEntry] = useState<ResumeSectionEntry | null>(null);
  const [headingMenuIdx, setHeadingMenuIdx] = useState(0);

  const panelW = panelInnerWidth(termCols);
  const textW = panelFramedTextWidth(termCols);
  const viewportH = panelContentViewportRows(termRows, 14);

  const api = hasApiKey();
  const variant = getDashboardVariant(snapshot, api);
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [profileLoadErr, setProfileLoadErr] = useState<string | null>(null);
  const [, setValidationState] = useValidationState();
  const [mdScroll, setMdScroll] = useState(0);

  const [editorBundle, setEditorBundle] = useState<RefineTuiLoadedState | null>(null);
  const [mdDraft, setMdDraft] = useState('');
  /** Bumped only when markdown is replaced externally (load, save normalize, polish); not on each keystroke. */
  const [mdExternalRevision, setMdExternalRevision] = useState(0);
  const [caretOffset, setCaretOffset] = useState(0);
  const [jumpToChar, setJumpToChar] = useState<{ nonce: number; offset: number } | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [docPolishDiff, setDocPolishDiff] = useState<{
    original: Profile;
    proposed: Profile;
  } | null>(null);
  const [polishDiffSelectIdx, setPolishDiffSelectIdx] = useState(0);
  /** When false, `inTextInput` is off so global screen jumps / palette work; Tab refocuses the editor. */
  const [resumeBodyFocused, setResumeBodyFocused] = useState(true);
  const mdDirtyRef = useRef(false);

  const resumeScrollRestoredRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Overlay state
  // ---------------------------------------------------------------------------
  const [overlay, setOverlay] = useState<EditorOverlay>(null);
  const overlayActive = panelActive && overlay != null;

  // JD pane state (only meaningful when mode === 'job')
  const [jdPaneMode, setJdPaneMode] = useState<JdPaneMode>('hidden');

  // QA state
  const [qaSource, setQaSource] = useState<Profile | null>(null);
  const [qaQuestions, setQaQuestions] = useState<RefinementQuestion[]>([]);
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});
  const [qaAnswerDraft, setQaAnswerDraft] = useState('');
  const [qaListFocus, setQaListFocus] = useState(false);

  // Diff overlay state
  const [overlayDiffSelectIdx, setOverlayDiffSelectIdx] = useState(0);
  const [overlaySummaryTweakDraft, setOverlaySummaryTweakDraft] = useState('');

  // Error state
  const [apiFailureStreak, setApiFailureStreak] = useState(0);
  const [errMenuIdx, setErrMenuIdx] = useState(0);

  // Persistence retry refs
  const persistCtxRef = useRef<{
    profile: Profile;
    qs: RefinementQuestion[];
    ans: Record<string, string>;
  } | null>(null);
  const persistKeepRef = useRef<Profile | null>(null);
  const persistKeepReasonRef = useRef<RefinementSaveReason>('unspecified');

  // Polish overlay state
  const [polishMenuIdx, setPolishMenuIdx] = useState(0);
  const lastPolishSectionsRef = useRef<string[]>([]);
  const lastPolishPositionIdsRef = useRef<string[] | undefined>(undefined);

  // Direct edit overlay state
  const [directEditDraft, setDirectEditDraft] = useState('');
  const lastDirectInstructionsRef = useRef('');
  const directEditViewportH = panelContentViewportRows(termRows, 12);

  // Consultant overlay state
  const consultantWorkRef = useRef<{
    base: Profile;
    evaluation: ProfileEvaluation;
    sectionScopeLabel?: string;
  } | null>(null);
  const lastConsultantSectionLabelRef = useRef<string | null>(null);
  const consultantPendingFindingsRef = useRef<ConsultantFinding[] | null>(null);
  const consultantEnrichFindingsRef = useRef<ConsultantFinding[] | null>(null);
  const consultantFbAnswersRef = useRef(new Map<number, string>());
  const [consultantFbDraft, setConsultantFbDraft] = useState('');
  const [consultantCheckboxItems, setConsultantCheckboxItems] = useState<
    Array<CheckboxItem<string>>
  >([]);
  const [consultantPickFocusIdx, setConsultantPickFocusIdx] = useState(0);
  const [consultantMenuIdx, setConsultantMenuIdx] = useState(0);
  const consultantScrollH = panelContentViewportRows(termRows, 14);

  // History overlay state
  const [historyMenuIdx, setHistoryMenuIdx] = useState(0);

  // ---------------------------------------------------------------------------
  // Original editor state management
  // ---------------------------------------------------------------------------

  // Reset markdown dirty flag when the persistence scope changes (intentional deps).
  // biome-ignore lint/correctness/useExhaustiveDependencies: profileDir/target define a new save scope
  useEffect(() => {
    mdDirtyRef.current = false;
    dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
    setResumeBodyFocused(true);
  }, [persistenceTarget, profileDir, dispatch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when diff overlay opens/closes
  useEffect(() => {
    setPolishDiffSelectIdx(0);
  }, [docPolishDiff]);

  useEffect(() => {
    if (loadedProfile == null) {
      setOutlineOpen(false);
      setHeadingMenuEntry(null);
    }
  }, [loadedProfile]);

  useEffect(() => {
    if (!snapshot.hasRefined || snapshot.loading || snapshot.error || !snapshot.hasSource) {
      setEditorBundle(null);
      setMdDraft('');
      setMdExternalRevision((n) => n + 1);
      setDocPolishDiff(null);
      setParseErr(null);
      setJumpToChar(null);
      return;
    }
    const target = persistenceTarget;
    let cancelled = false;
    void loadRefinedTuiState(profileDir, target).then((b) => {
      if (cancelled || persistenceTargetRef.current !== target) {
        return;
      }
      setEditorBundle(b);
      if (!mdDirtyRef.current) {
        setMdDraft(stripHtmlCommentsFromProfileMarkdown(profileMarkdownContent(b.profile)));
        setMdExternalRevision((n) => n + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    profileDir,
    persistenceTarget,
    snapshot.error,
    snapshot.hasRefined,
    snapshot.hasSource,
    snapshot.loading,
  ]);

  useEffect(() => {
    resumeScrollRestoredRef.current = false;
    if (snapshot.loading || snapshot.error || !snapshot.hasSource) {
      setLoadedProfile(null);
      setProfileLoadErr(null);
      setValidationState({ valid: null, error: null });
      setMdScroll(0);
      return;
    }
    let cancelled = false;
    void loadActiveProfile(profileDir)
      .then((p) => {
        if (cancelled) {
          return;
        }
        setLoadedProfile(p);
        setProfileLoadErr(null);
        try {
          validateProfile(p);
          setValidationState({ valid: true, error: null });
        } catch (e: unknown) {
          setValidationState({ valid: false, error: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadedProfile(null);
          setProfileLoadErr(e instanceof Error ? e.message : String(e));
          setValidationState({ valid: null, error: null });
          setMdScroll(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileDir, snapshot.loading, snapshot.error, snapshot.hasSource, setValidationState]);

  const editorMode = snapshot.hasRefined && editorBundle != null;
  const resumeEditorReady = !snapshot.hasRefined || editorBundle != null;

  const mdSourceLines = useMemo(() => {
    if (loadedProfile == null) {
      return [] as string[];
    }
    return splitLinesForWrap(profileMarkdownContent(loadedProfile));
  }, [loadedProfile]);

  const mdDisplayRows = useMemo(
    () => linesToWrappedRows(mdSourceLines, textW),
    [mdSourceLines, textW],
  );

  const mdRowElements = useMemo(
    () => wrappedMarkdownHintRows(mdSourceLines, textW),
    [mdSourceLines, textW],
  );

  const resumeDocVisible =
    panelActive &&
    snapshot.hasSource &&
    !snapshot.loading &&
    !snapshot.error &&
    loadedProfile != null &&
    resumeEditorReady &&
    (editorMode || mdDisplayRows.length > 0);
  const panelFooterHintText = resumeDocVisible
    ? editorMode
      ? resumeBodyFocused
        ? `Resume · Esc: nav mode · Ctrl+O outline · PgUp/PgDn · wheel scroll · Ctrl+S save · Ctrl+P polish · Ctrl+E consultant · 1–${SCREEN_ORDER.length} · : palette`
        : `Resume · Tab: edit · 1–${SCREEN_ORDER.length} · d i c e j g s · : palette · o / Ctrl+O outline`
      : `Resume · ↑↓ PgUp/PgDn · wheel scroll · o outline · Enter on heading · 1–${SCREEN_ORDER.length} · d i c e j g s · : palette`
    : `Resume · ↑↓ PgUp/PgDn scroll document · 1–${SCREEN_ORDER.length} · d i c e j g s · : palette`;
  useRegisterPanelFooterHint(panelFooterHintText);

  const mdMaxScroll = Math.max(0, mdDisplayRows.length - viewportH);
  const mdScrollClamped = Math.min(mdScroll, mdMaxScroll);

  const sectionEntries = useMemo(() => {
    const p = editorMode ? editorBundle?.profile : loadedProfile;
    return p != null ? buildResumeSectionIndex(p) : [];
  }, [editorMode, editorBundle?.profile, loadedProfile]);
  const sectionScrollMap = useMemo(
    () => (loadedProfile != null ? buildSectionScrollRowMap(loadedProfile, textW) : new Map()),
    [loadedProfile, textW],
  );

  const docMenuOpen = outlineOpen || headingMenuEntry != null;

  const resumeEditorHostRef = useRef<DOMElement | null>(null);
  const [resumeEditorMeasuredLines, setResumeEditorMeasuredLines] = useState<number | null>(null);
  const lastMeasureKeyRef = useRef<string>('');
  const measuredLinesRef = useRef<number | null>(null);

  // Measure editor height only when terminal size changes or editor mode activates
  useLayoutEffect(() => {
    if (!editorMode || editorBundle == null) {
      setResumeEditorMeasuredLines(null);
      measuredLinesRef.current = null;
      return;
    }
    // Create a stable measure key - only remeasure when terminal dimensions change
    const measureKey = `${termCols}x${termRows}`;
    if (measureKey === lastMeasureKeyRef.current && measuredLinesRef.current != null) {
      return; // Already measured for this terminal size
    }
    lastMeasureKeyRef.current = measureKey;

    const el = resumeEditorHostRef.current;
    if (el?.yogaNode == null) {
      return;
    }
    const allocated = Math.round(measureElement(el).height);
    if (allocated <= 0) {
      return;
    }
    const lines =
      allocated - resumeEditorSectionBlockRows(parseErr) - RESUME_EDITOR_VIEWPORT_CHROME_ROWS;
    const finalLines = Math.max(3, lines);
    measuredLinesRef.current = finalLines;
    setResumeEditorMeasuredLines(finalLines);
  }, [termCols, termRows, editorMode, editorBundle, parseErr]);

  const resumeEditorLineSlots =
    resumeEditorMeasuredLines ??
    Math.max(
      3,
      viewportH - resumeEditorSectionBlockRows(parseErr) - RESUME_EDITOR_VIEWPORT_CHROME_ROWS,
    );

  useRegisterBlockingUi(
    panelActive &&
      loadedProfile != null &&
      (docMenuOpen || docPolishDiff != null || overlayActive),
  );

  const resumeWheelScrollActive =
    panelActive &&
    loadedProfile != null &&
    !paletteOpen &&
    !docMenuOpen &&
    docPolishDiff == null &&
    overlay == null &&
    ((!editorMode && mdDisplayRows.length > 0) || (editorMode && resumeBodyFocused));

  useTerminalSgrMouse(resumeWheelScrollActive);

  const polishDiffBlocks = useMemo(() => {
    if (docPolishDiff == null) {
      return [];
    }
    return computeRefinementDiff(docPolishDiff.original, docPolishDiff.proposed);
  }, [docPolishDiff]);

  const tryParseDraft = useCallback((): Profile | null => {
    if (editorBundle == null) {
      return null;
    }
    try {
      const p = parseDisplayMarkdownStringToProfile(mdDraft, editorBundle.profile);
      setParseErr(null);
      return p;
    } catch (e: unknown) {
      setParseErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [editorBundle, mdDraft]);

  const persistEditorProfile = useCallback(
    async (profile: Profile) => {
      if (editorBundle == null) {
        return;
      }
      await saveRefinedForPersistenceTarget(persistenceTarget, {
        profile,
        session: editorBundle.session,
        profileDir,
      });
      setEditorBundle((b) => (b ? { ...b, profile } : null));
      setMdDraft(stripHtmlCommentsFromProfileMarkdown(profileMarkdownContent(profile)));
      setMdExternalRevision((n) => n + 1);
      mdDirtyRef.current = false;
      dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
      onRefreshSnapshot?.();
    },
    [dispatch, editorBundle, onRefreshSnapshot, persistenceTarget, profileDir],
  );

  // ---------------------------------------------------------------------------
  // Helper: reload editor bundle after overlay save completes
  // ---------------------------------------------------------------------------
  const reloadEditorAfterOverlaySave = useCallback(() => {
    setOverlay(null);
    setResumeBodyFocused(true);
    mdDirtyRef.current = false;
    dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
    // Force re-load the editor bundle from disk
    const target = persistenceTarget;
    void loadRefinedTuiState(profileDir, target).then((b) => {
      if (persistenceTargetRef.current !== target) return;
      setEditorBundle(b);
      setMdDraft(stripHtmlCommentsFromProfileMarkdown(profileMarkdownContent(b.profile)));
      setMdExternalRevision((n) => n + 1);
    });
    onRefreshSnapshot?.();
  }, [dispatch, onRefreshSnapshot, persistenceTarget, profileDir]);

  // ---------------------------------------------------------------------------
  // Overlay effect: reset menu indices when overlay changes
  // ---------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset indices on overlay kind change
  useEffect(() => {
    if (overlay?.k === 'diff') {
      setOverlayDiffSelectIdx(0);
    }
    if (overlay?.k === 'history-list') {
      setHistoryMenuIdx(0);
    }
    if (overlay?.k !== 'qa') {
      setQaListFocus(false);
    }
  }, [overlay?.k]);

  // ---------------------------------------------------------------------------
  // Overlay persistence callbacks (ported from RefineScreen)
  // ---------------------------------------------------------------------------

  const overlayPersistRefined = useCallback(
    async (profile: Profile, qs: RefinementQuestion[], ans: Record<string, string>) => {
      persistCtxRef.current = { profile, qs, ans };
      persistKeepRef.current = null;
      setOverlay({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const sourceHash = await hashSource(profileDir);
        const session: RefinementSession = {
          conductedAt: new Date().toISOString(),
          sourceHash,
          questions: qs,
          answers: ans,
        };
        await saveRefinedForPersistenceTarget(
          persistenceTarget,
          { profile, session, profileDir },
          { reason: 'qa-save' },
        );
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        setOverlay({
          k: 'done',
          note:
            persistenceTarget.kind === 'job'
              ? 'Refinements saved to job refined profile.'
              : 'Refinements saved to refined.json / refined.md',
        });
      } catch (e) {
        setErrMenuIdx(0);
        setOverlay({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'save',
        });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, persistenceTarget, profileDir],
  );

  const overlayPersistRefinedKeepSession = useCallback(
    async (profile: Profile, reason: RefinementSaveReason) => {
      persistKeepRef.current = profile;
      persistKeepReasonRef.current = reason;
      persistCtxRef.current = null;
      setOverlay({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const { session: existingSession } = await loadRefinedTuiState(
          profileDir,
          persistenceTarget,
        );
        await saveRefinedForPersistenceTarget(
          persistenceTarget,
          { profile, session: existingSession, profileDir },
          { reason },
        );
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        consultantWorkRef.current = null;
        consultantPendingFindingsRef.current = null;
        consultantEnrichFindingsRef.current = null;
        setOverlay({
          k: 'done',
          note:
            persistenceTarget.kind === 'job'
              ? 'Updated job refined profile (Q&A session unchanged).'
              : 'Updated refined.json / refined.md (Q&A session unchanged).',
        });
      } catch (e) {
        setErrMenuIdx(0);
        setOverlay({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'save',
        });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, persistenceTarget, profileDir],
  );

  const overlaySyncRefinedFromMarkdown = useCallback(async () => {
    setOverlay({ k: 'syncing-md' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const existing = await loadRefinedTuiState(profileDir, persistenceTarget);
      const mdPath = refinedMdPathForTarget(profileDir, persistenceTarget);
      const updatedProfile = await markdownToProfile(mdPath, existing.profile);
      await saveRefinedForPersistenceTarget(
        persistenceTarget,
        {
          profile: updatedProfile,
          session: existing.session,
          profileDir,
        },
        { reason: 'md-sync' },
      );
      reloadEditorAfterOverlaySave();
    } catch (e) {
      setErrMenuIdx(0);
      setOverlay({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'sync',
      });
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, persistenceTarget, profileDir, reloadEditorAfterOverlaySave]);

  // ---------------------------------------------------------------------------
  // Overlay: dismiss overlay (return to editor)
  // ---------------------------------------------------------------------------
  const dismissOverlay = useCallback(() => {
    setOverlay(null);
    setResumeBodyFocused(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Overlay: restore consultant view from work ref
  // ---------------------------------------------------------------------------
  const restoreConsultantView = useCallback(() => {
    const w = consultantWorkRef.current;
    if (!w) {
      dismissOverlay();
      return;
    }
    setConsultantMenuIdx(0);
    setConsultantFbDraft('');
    setOverlay({
      k: 'consultant-view',
      evaluation: w.evaluation,
      previewLines: formatProfileEvaluationLines(
        w.evaluation,
        w.sectionScopeLabel ? { sectionScope: w.sectionScopeLabel } : undefined,
      ),
      scroll: 0,
      sectionScopeLabel: w.sectionScopeLabel,
    });
  }, [dismissOverlay]);

  // ---------------------------------------------------------------------------
  // Overlay flow callbacks (ported from RefineScreen)
  // ---------------------------------------------------------------------------

  const overlayBeginQaFlow = useCallback(async () => {
    // For QA flow, load the source profile
    let src: Profile;
    try {
      src = await loadSource(profileDir);
    } catch (e) {
      setErrMenuIdx(0);
      setOverlay({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'gen-questions',
      });
      return;
    }
    setQaSource(src);
    const ac = createController();
    setOverlay({ k: 'gen-questions' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const qs = await generateRefinementQuestions(src, ac.signal);
      setQaQuestions(qs);
      if (qs.length === 0) {
        const sourceHash = await hashSource(profileDir);
        const session: RefinementSession = {
          conductedAt: new Date().toISOString(),
          sourceHash,
          questions: [],
          answers: {},
        };
        await saveRefinedForPersistenceTarget(
          persistenceTarget,
          { profile: src, session, profileDir },
          { reason: 'qa-save' },
        );
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        setOverlay({ k: 'done', note: 'No gaps found — saved source as refined (no edits).' });
        return;
      }
      setQaAnswers({});
      setQaAnswerDraft('');
      setQaListFocus(false);
      setApiFailureStreak(0);
      setOverlay({ k: 'qa', questions: qs, index: 0 });
    } catch (e) {
      if (isUserAbort(e)) {
        dismissOverlay();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setOverlay({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'gen-questions',
      });
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [
    createController,
    dismissOverlay,
    dispatch,
    persistenceTarget,
    profileDir,
    releaseController,
  ]);

  const overlayRunApply = useCallback(
    async (answersSnapshot?: Record<string, string>) => {
      if (!qaSource) {
        return;
      }
      const ans = answersSnapshot ?? qaAnswers;
      const ac = createController();
      setOverlay({ k: 'qa-apply' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const proposed = await applyRefinements(qaSource, qaQuestions, ans, ac.signal);
        const blocks = computeRefinementDiff(qaSource, proposed);
        if (blocks.length === 0) {
          await overlayPersistRefined(proposed, qaQuestions, ans);
          return;
        }
        setApiFailureStreak(0);
        setOverlay({ k: 'diff', original: qaSource, proposed, saveMode: 'qa' });
      } catch (e) {
        if (isUserAbort(e)) {
          setQaListFocus(false);
          setOverlay({ k: 'qa', questions: qaQuestions, index: Math.max(0, qaQuestions.length - 1) });
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setOverlay({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'apply',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, overlayPersistRefined, qaAnswers, qaQuestions, qaSource, releaseController],
  );

  const overlayRunPolish = useCallback(
    async (sections: string[], polishOpts?: { positionIds?: string[] }) => {
      lastPolishSectionsRef.current = sections;
      lastPolishPositionIdsRef.current = polishOpts?.positionIds;
      const ac = createController();
      setOverlay({ k: 'polish-run', sections });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const { profile: existingProfile } = await loadRefinedTuiState(
          profileDir,
          persistenceTarget,
        );
        const base = cloneProfile(existingProfile);
        let proposed = base;
        for await (const ev of polishProfile(
          base,
          { sections, positionIds: polishOpts?.positionIds },
          ac.signal,
        )) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          await overlayPersistRefinedKeepSession(proposed, 'polish');
          return;
        }
        setOverlay({
          k: 'diff',
          original: base,
          proposed,
          saveMode: 'keep-session',
          keepSessionReason: 'polish',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          dismissOverlay();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setOverlay({
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
      dismissOverlay,
      dispatch,
      overlayPersistRefinedKeepSession,
      persistenceTarget,
      profileDir,
      releaseController,
    ],
  );

  const overlayRunAiSniff = useCallback(async () => {
    const ac = createController();
    setOverlay({ k: 'sniff-run' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const { profile: existingProfile } = await loadRefinedTuiState(profileDir, persistenceTarget);
      const base = cloneProfile(existingProfile);
      let proposed = base;
      for await (const ev of sniffReduceAiTellsProfile(base, ac.signal)) {
        if (ev.type === 'done') {
          proposed = ev.result;
        }
      }
      const blocks = computeRefinementDiff(base, proposed);
      setApiFailureStreak(0);
      if (blocks.length === 0) {
        await overlayPersistRefinedKeepSession(proposed, 'ai-sniff');
        return;
      }
      setOverlay({
        k: 'diff',
        original: base,
        proposed,
        saveMode: 'keep-session',
        keepSessionReason: 'ai-sniff',
      });
    } catch (e) {
      if (isUserAbort(e)) {
        dismissOverlay();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setOverlay({
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
    dismissOverlay,
    dispatch,
    overlayPersistRefinedKeepSession,
    persistenceTarget,
    profileDir,
    releaseController,
  ]);

  const overlayRunDirectEdit = useCallback(
    async (instructions: string) => {
      lastDirectInstructionsRef.current = instructions;
      const ac = createController();
      setOverlay({ k: 'direct-edit-run', instructions });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const { profile: existingProfile } = await loadRefinedTuiState(
          profileDir,
          persistenceTarget,
        );
        const base = cloneProfile(existingProfile);
        let proposed = base;
        for await (const ev of applyDirectEdit(base, instructions, ac.signal)) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          await overlayPersistRefinedKeepSession(proposed, 'direct-edit');
          return;
        }
        setOverlay({
          k: 'diff',
          original: base,
          proposed,
          saveMode: 'keep-session',
          keepSessionReason: 'direct-edit',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          dismissOverlay();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setOverlay({
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
      dismissOverlay,
      dispatch,
      overlayPersistRefinedKeepSession,
      persistenceTarget,
      profileDir,
      releaseController,
    ],
  );

  const overlayRunConsultantReview = useCallback(async () => {
    consultantWorkRef.current = null;
    consultantPendingFindingsRef.current = null;
    consultantEnrichFindingsRef.current = null;
    lastConsultantSectionLabelRef.current = null;
    const ac = createController();
    setOverlay({ k: 'consultant-run' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const { profile: existingProfile } = await loadRefinedTuiState(profileDir, persistenceTarget);
      const base = cloneProfile(existingProfile);
      const evaluation = await evaluateProfile(base);
      const previewLines = formatProfileEvaluationLines(evaluation);
      consultantWorkRef.current = { base, evaluation };
      setConsultantMenuIdx(0);
      setOverlay({
        k: 'consultant-view',
        evaluation,
        previewLines,
        scroll: 0,
      });
      setApiFailureStreak(0);
    } catch (e) {
      if (isUserAbort(e)) {
        dismissOverlay();
        return;
      }
      setApiFailureStreak((n) => n + 1);
      setErrMenuIdx(0);
      setOverlay({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'consultant',
      });
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [
    createController,
    dismissOverlay,
    dispatch,
    persistenceTarget,
    profileDir,
    releaseController,
  ]);

  const overlayRunConsultantSectionReview = useCallback(
    async (sectionLabel: string, opts?: { experiencePositionId?: string }) => {
      consultantWorkRef.current = null;
      consultantPendingFindingsRef.current = null;
      consultantEnrichFindingsRef.current = null;
      lastConsultantSectionLabelRef.current = sectionLabel;
      const ac = createController();
      setOverlay({ k: 'consultant-section-run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const { profile: existingProfile } = await loadRefinedTuiState(
          profileDir,
          persistenceTarget,
        );
        const base = cloneProfile(existingProfile);
        const evalLabel =
          opts?.experiencePositionId != null && sectionLabel === 'Experience'
            ? buildExperiencePositionConsultantLabel(base, opts.experiencePositionId)
            : sectionLabel;
        lastConsultantSectionLabelRef.current = evalLabel;
        const evaluation = await evaluateProfileSection(base, evalLabel, ac.signal);
        const previewLines = formatProfileEvaluationLines(evaluation, {
          sectionScope: evalLabel,
        });
        consultantWorkRef.current = { base, evaluation, sectionScopeLabel: evalLabel };
        setConsultantMenuIdx(0);
        setConsultantFbDraft('');
        setOverlay({
          k: 'consultant-view',
          evaluation,
          previewLines,
          scroll: 0,
          sectionScopeLabel: evalLabel,
        });
        setApiFailureStreak(0);
      } catch (e) {
        if (isUserAbort(e)) {
          lastConsultantSectionLabelRef.current = null;
          dismissOverlay();
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setOverlay({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'consultant-section',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [
      createController,
      dismissOverlay,
      dispatch,
      persistenceTarget,
      profileDir,
      releaseController,
    ],
  );

  const overlayRunConsultantApplyWithFindings = useCallback(
    async (findings: ConsultantFinding[]) => {
      const work = consultantWorkRef.current;
      if (!work || findings.length === 0) {
        return;
      }
      const { base, evaluation } = work;
      consultantPendingFindingsRef.current = findings;
      const ac = createController();
      setOverlay({ k: 'consultant-apply' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const proposed = await applyConsultantFindingsToProfile(base, findings, ac.signal);
        const blocks = computeRefinementDiff(base, proposed);
        setApiFailureStreak(0);
        if (blocks.length === 0) {
          consultantPendingFindingsRef.current = null;
          await overlayPersistRefinedKeepSession(proposed, 'consultant');
          return;
        }
        setOverlay({
          k: 'diff',
          original: base,
          proposed,
          saveMode: 'keep-session',
          keepSessionReason: 'consultant',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          setConsultantMenuIdx(0);
          setOverlay({
            k: 'consultant-view',
            evaluation,
            previewLines: formatProfileEvaluationLines(
              evaluation,
              work.sectionScopeLabel ? { sectionScope: work.sectionScopeLabel } : undefined,
            ),
            scroll: 0,
            sectionScopeLabel: work.sectionScopeLabel,
          });
          return;
        }
        setApiFailureStreak((n) => n + 1);
        setErrMenuIdx(0);
        setOverlay({
          k: 'err',
          msg: (e as Error).message,
          retryKind: 'consultant',
        });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [createController, dispatch, overlayPersistRefinedKeepSession, releaseController],
  );

  const overlayRunConsultantEnrichAndApply = useCallback(
    async (findings: ConsultantFinding[]) => {
      const work = consultantWorkRef.current;
      if (!work || findings.length === 0) {
        return;
      }
      consultantEnrichFindingsRef.current = findings;
      const ac = createController();
      setOverlay({ k: 'consultant-questions-run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const profileText = profileToRefineText(work.base);
        const qs = await fetchConsultantFeedbackQuestions(findings, profileText, ac.signal);
        if (qs.length === 0) {
          dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
          releaseController(ac);
          await overlayRunConsultantApplyWithFindings(findings);
          return;
        }
        consultantFbAnswersRef.current = new Map();
        setConsultantFbDraft('');
        setOverlay({
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
        setOverlay({
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
      overlayRunConsultantApplyWithFindings,
      releaseController,
      restoreConsultantView,
    ],
  );

  const overlayOpenRefinementHistory = useCallback(async () => {
    try {
      const { entries, warnings } = await listGlobalRefinementHistory(profileDir);
      setOverlay({ k: 'history-list', entries, warnings });
    } catch (e) {
      setErrMenuIdx(0);
      setOverlay({
        k: 'err',
        msg: (e as Error).message,
        retryKind: 'save',
      });
    }
  }, [profileDir]);

  const overlayRunRestoreFromHistory = useCallback(
    async (entry: RefinementHistoryListEntry) => {
      setOverlay({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        await restoreGlobalRefinedSnapshot(profileDir, entry.id);
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setOverlay({ k: 'done', note: `Restored refinement snapshot ${entry.id}.` });
      } catch (e) {
        setErrMenuIdx(0);
        setOverlay({
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

  // ---------------------------------------------------------------------------
  // Consume editor commands dispatched from CommandPalette
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!editorCommand || overlay != null) return;
    dispatch({ type: 'SET_EDITOR_COMMAND', command: null });
    switch (editorCommand) {
      case ':qa':
        void overlayBeginQaFlow();
        break;
      case ':polish':
        setOverlay({ k: 'polish-pick' });
        break;
      case ':sniff':
        void overlayRunAiSniff();
        break;
      case ':edit':
        setOverlay({ k: 'direct-edit-input' });
        break;
      case ':consultant':
        void overlayRunConsultantReview();
        break;
      case ':history':
        void overlayOpenRefinementHistory();
        break;
      case ':sections':
        dispatch({ type: 'SET_PROFILE_EDITOR_RETURN_TO', screen: activeScreen });
        navigate('profile');
        break;
    }
  }, [
    editorCommand,
    overlay,
    dispatch,
    overlayBeginQaFlow,
    overlayRunAiSniff,
    overlayRunConsultantReview,
    overlayOpenRefinementHistory,
    activeScreen,
    navigate,
  ]);

  // ---------------------------------------------------------------------------
  // Existing inline polish (Ctrl+P)
  // ---------------------------------------------------------------------------
  const runDashboardPolish = useCallback(async () => {
    if (editorBundle == null || !api) {
      return;
    }
    const parsed = tryParseDraft();
    if (parsed == null) {
      return;
    }
    const sid = resumeSectionIdAtMarkdownOffset(mdDraft, caretOffset, sectionEntries);
    const sectionIds = polishSectionIdsForResumeSection(sid);
    if (sectionIds == null) {
      setParseErr('Polish targets Summary, Experience, and Skills only.');
      return;
    }
    const experiencePositionId =
      sid === 'experience'
        ? resumeExperiencePositionIdForEditorView(mdDraft, caretOffset, parsed, sectionEntries)
        : null;
    const positionIds =
      experiencePositionId != null && sectionIds.includes('experience')
        ? [experiencePositionId]
        : undefined;
    const ac = createController();
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const base = cloneProfile(parsed);
      let proposed = base;
      for await (const ev of polishProfile(
        base,
        { sections: sectionIds, positionIds },
        ac.signal,
      )) {
        if (ev.type === 'done') {
          proposed = ev.result;
        }
      }
      const blocks = computeRefinementDiff(base, proposed);
      if (blocks.length === 0) {
        await persistEditorProfile(proposed);
        return;
      }
      setDocPolishDiff({ original: base, proposed });
    } catch (e: unknown) {
      if (isUserAbort(e)) {
        return;
      }
      setParseErr(e instanceof Error ? e.message : String(e));
    } finally {
      releaseController(ac);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [
    api,
    caretOffset,
    createController,
    dispatch,
    editorBundle,
    mdDraft,
    persistEditorProfile,
    releaseController,
    sectionEntries,
    tryParseDraft,
  ]);

  // ---------------------------------------------------------------------------
  // Ctrl+E consultant: now runs as overlay instead of navigating to RefineScreen
  // ---------------------------------------------------------------------------
  const runDashboardConsultant = useCallback(async () => {
    if (editorBundle == null) {
      return;
    }
    const sid = resumeSectionIdAtMarkdownOffset(mdDraft, caretOffset, sectionEntries);
    if (sid == null || !isRefinableSectionId(sid)) {
      setParseErr('Move the cursor into Summary, Experience, or Skills for section consultant.');
      return;
    }
    const parsed = tryParseDraft();
    if (parsed == null) {
      return;
    }
    try {
      await saveRefinedForPersistenceTarget(persistenceTarget, {
        profile: parsed,
        session: editorBundle.session,
        profileDir,
      });
      setEditorBundle((b) => (b ? { ...b, profile: parsed } : null));
      mdDirtyRef.current = false;
      dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
      const experiencePositionId =
        sid === 'experience'
          ? resumeExperiencePositionIdForEditorView(mdDraft, caretOffset, parsed, sectionEntries)
          : undefined;
      const sectionLabel = sid === 'summary' ? 'Summary' : sid === 'experience' ? 'Experience' : 'Skills';
      setResumeBodyFocused(false);
      void overlayRunConsultantSectionReview(
        sectionLabel,
        experiencePositionId != null ? { experiencePositionId } : undefined,
      );
    } catch (e: unknown) {
      setParseErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    caretOffset,
    dispatch,
    editorBundle,
    mdDraft,
    overlayRunConsultantSectionReview,
    persistenceTarget,
    profileDir,
    sectionEntries,
    tryParseDraft,
  ]);

  const activeSectionLabel = useMemo(() => {
    if (!editorMode || editorBundle == null) {
      return '';
    }
    const sid = resumeSectionIdAtMarkdownOffset(mdDraft, caretOffset, sectionEntries);
    if (sid == null) {
      return 'Preamble / contact';
    }
    if (sid === 'experience') {
      const pid = resumeExperiencePositionIdForEditorView(
        mdDraft,
        caretOffset,
        editorBundle.profile,
        sectionEntries,
      );
      if (pid != null) {
        const short = experiencePositionShortLabel(editorBundle.profile, pid);
        return short != null ? `Experience · ${short}` : `Experience · ${pid}`;
      }
      return 'Experience (pick a role block)';
    }
    const entry = sectionEntries.find((e) => e.id === sid);
    return entry?.label ?? sid;
  }, [caretOffset, editorBundle, editorMode, mdDraft, sectionEntries]);

  // Notify parent of section changes
  useEffect(() => {
    onSectionChange?.(activeSectionLabel || null);
  }, [activeSectionLabel, onSectionChange]);

  const outlineItems = useMemo(
    () => sectionEntries.map((e) => ({ value: e.id, label: e.label })),
    [sectionEntries],
  );

  const headingActionItems = useMemo((): Array<{ value: string; label: string }> => {
    if (headingMenuEntry == null) {
      return [];
    }
    const e = headingMenuEntry;
    if (isRefinableSectionId(e.id)) {
      return [
        { value: 'polish', label: 'Polish section' },
        { value: 'consultant', label: 'Section consultant review' },
        { value: 'cancel', label: 'Cancel' },
      ];
    }
    return [
      { value: 'cancel', label: 'Cancel' },
    ];
  }, [headingMenuEntry]);

  useLayoutEffect(() => {
    if (!snapshot.hasSource || loadedProfile == null) {
      return;
    }
    if (resumeScrollRestoredRef.current) {
      return;
    }
    resumeScrollRestoredRef.current = true;
    const stored = readResumeScroll(profileDir);
    if (stored !== undefined) {
      setMdScroll(Math.min(stored, mdMaxScroll));
    }
  }, [loadedProfile, profileDir, mdMaxScroll, snapshot.hasSource]);

  useEffect(() => {
    setMdScroll((s) => Math.min(s, mdMaxScroll));
  }, [mdMaxScroll]);

  useEffect(() => {
    if (loadedProfile == null || !snapshot.hasSource) {
      return;
    }
    const scroll = mdScrollClamped;
    const dir = profileDir;
    const t = setTimeout(() => {
      rememberResumeScroll(dir, scroll);
    }, 0);
    return () => clearTimeout(t);
  }, [mdScrollClamped, profileDir, loadedProfile, snapshot.hasSource]);

  // ---------------------------------------------------------------------------
  // Input handlers
  // ---------------------------------------------------------------------------

  // Read-only scroll (arrow keys, PgUp/PgDn, mouse wheel)
  useInput(
    (input, key) => {
      if (!panelActive || loadedProfile == null || mdDisplayRows.length === 0 || editorMode) {
        return;
      }
      const mouse = parseSgrMouseEvent(input);
      if (mouse?.kind === 'wheel') {
        setMdScroll((s) => Math.max(0, Math.min(mdMaxScroll, s + mouse.delta)));
        return;
      }
      if (mouse != null) {
        return;
      }
      const step = Math.max(1, viewportH - 1);
      if (key.pageUp) {
        setMdScroll((s) => Math.max(0, s - step));
        return;
      }
      if (key.pageDown) {
        setMdScroll((s) => Math.min(mdMaxScroll, s + step));
        return;
      }
      if (key.upArrow) {
        setMdScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setMdScroll((s) => Math.min(mdMaxScroll, s + 1));
      }
    },
    {
      isActive:
        panelActive &&
        loadedProfile != null &&
        mdDisplayRows.length > 0 &&
        !docMenuOpen &&
        !editorMode &&
        overlay == null,
    },
  );

  // Ctrl+P polish, Ctrl+E consultant
  useInput(
    (input, key) => {
      if (!key.ctrl || input == null) {
        return;
      }
      const low = input.toLowerCase();
      if (low === 'p') {
        void runDashboardPolish();
        return;
      }
      if (low === 'e') {
        void runDashboardConsultant();
      }
    },
    {
      isActive:
        panelActive &&
        editorMode &&
        !docMenuOpen &&
        docPolishDiff == null &&
        overlay == null &&
        inTextInput &&
        resumeBodyFocused &&
        Boolean(api),
    },
  );

  // Esc to close outline/heading menu
  useInput(
    (_input, key) => {
      if (!panelActive || !docMenuOpen) {
        return;
      }
      if (key.escape) {
        setOutlineOpen(false);
        setHeadingMenuEntry(null);
      }
    },
    { isActive: panelActive && docMenuOpen && overlay == null },
  );

  // Esc to blur editor (enter nav mode)
  useInput(
    (_input, key) => {
      if (key.escape) {
        setResumeBodyFocused(false);
      }
    },
    {
      isActive:
        panelActive && editorMode && !docMenuOpen && docPolishDiff == null && overlay == null && resumeBodyFocused,
    },
  );

  // Tab to refocus editor
  useInput(
    (_input, key) => {
      if (key.tab) {
        setResumeBodyFocused(true);
      }
    },
    {
      isActive:
        panelActive && editorMode && !docMenuOpen && docPolishDiff == null && overlay == null && !resumeBodyFocused,
    },
  );

  // Esc in nav mode (no overlay/menu) => close editor
  useInput(
    (_input, key) => {
      if (key.escape && !resumeBodyFocused && !docMenuOpen && docPolishDiff == null && overlay == null) {
        onRequestClose();
      }
    },
    {
      isActive:
        panelActive && editorMode && !resumeBodyFocused && !docMenuOpen && docPolishDiff == null && overlay == null,
    },
  );

  // Ctrl+J: cycle JD pane modes (hidden -> peek -> full -> hidden), only in job mode
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'j') {
        setJdPaneMode((m) => {
          if (m === 'hidden') return 'peek';
          if (m === 'peek') return 'full';
          return 'hidden';
        });
      }
    },
    { isActive: panelActive && mode === 'job' && overlay == null },
  );

  // Job-mode nav keybinds (when not editing body)
  useInput(
    (input, _key) => {
      if (input === 'p') {
        // Prepare: no-op until CurateScreen is wired
      }
      if (input === 'f') {
        // Feedback/job-fit evaluation: future overlay
      }
      if (input === 'g') {
        // Generate: open Generate with this job pre-selected
        if (jobId) {
          dispatch({ type: 'SET_PENDING_JOB', jobId });
          navigate('generate');
        }
      }
      if (input === 'l') {
        // Cover letter: future overlay
      }
    },
    {
      isActive:
        panelActive &&
        mode === 'job' &&
        !resumeBodyFocused &&
        !docMenuOpen &&
        overlay == null &&
        docPolishDiff == null,
    },
  );

  // Outline open + Enter on heading
  useInput(
    (input, key) => {
      if (!panelActive || !resumeDocVisible || docMenuOpen || overlay != null) {
        return;
      }
      if (input === 'o' || input === 'O') {
        if (editorMode && inTextInput && !key.ctrl) {
          return;
        }
        if (sectionEntries.length === 0) {
          return;
        }
        setOutlineIdx(0);
        setOutlineOpen(true);
        return;
      }
      if (key.return) {
        if (editorMode) {
          return;
        }
        const top = mdDisplayRows[mdScrollClamped] ?? '';
        const entry = matchSectionEntryForHeadingLine(top, sectionEntries);
        if (entry == null) {
          return;
        }
        setHeadingMenuIdx(0);
        setHeadingMenuEntry(entry);
      }
    },
    {
      isActive: panelActive && resumeDocVisible && !docMenuOpen && overlay == null && loadedProfile != null,
    },
  );

  // ---------------------------------------------------------------------------
  // Overlay input handlers
  // ---------------------------------------------------------------------------

  // Esc in diff-edit-summary overlay
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'diff-edit-summary' || !inTextInput) {
        return;
      }
      if (key.escape) {
        setOverlay({
          k: 'diff',
          original: overlay.original,
          proposed: overlay.proposed,
          saveMode: overlay.saveMode,
          keepSessionReason: overlay.keepSessionReason,
        });
      }
    },
    { isActive: overlayActive && overlay?.k === 'diff-edit-summary' },
  );

  // Esc for polish-pick, consultant-view, consultant-pick, direct-edit-input
  useInput(
    (_input, key) => {
      if (!overlayActive || !key.escape) {
        return;
      }
      if (overlay?.k === 'direct-edit-input') {
        setDirectEditDraft('');
        dismissOverlay();
        return;
      }
      if (inTextInput) {
        return;
      }
      if (overlay?.k === 'consultant-pick') {
        restoreConsultantView();
        return;
      }
      if (overlay?.k === 'polish-pick') {
        dismissOverlay();
        return;
      }
      if (overlay?.k === 'consultant-view') {
        consultantWorkRef.current = null;
        consultantPendingFindingsRef.current = null;
        consultantEnrichFindingsRef.current = null;
        lastConsultantSectionLabelRef.current = null;
        dismissOverlay();
      }
    },
    {
      isActive:
        overlayActive &&
        (overlay?.k === 'polish-pick' ||
          overlay?.k === 'direct-edit-input' ||
          overlay?.k === 'consultant-view' ||
          overlay?.k === 'consultant-pick'),
    },
  );

  // Esc in QA overlay
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'qa' || !key.escape) {
        return;
      }
      setQaAnswerDraft('');
      setQaListFocus(false);
      dismissOverlay();
    },
    { isActive: overlayActive && overlay?.k === 'qa' },
  );

  // Shift+Tab in QA overlay (toggle list/answer focus)
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'qa') {
        return;
      }
      if (key.shift && key.tab) {
        setQaListFocus((prev) => !prev);
      }
    },
    { isActive: overlayActive && overlay?.k === 'qa' },
  );

  // Esc in consultant-feedback-qa overlay
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'consultant-feedback-qa' || !key.escape) {
        return;
      }
      setConsultantFbDraft('');
      restoreConsultantView();
    },
    { isActive: overlayActive && overlay?.k === 'consultant-feedback-qa' },
  );

  // PgUp/PgDn in consultant-view overlay
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'consultant-view' || inTextInput) {
        return;
      }
      const maxScroll = wrappedScrollMax(overlay.previewLines, consultantScrollH, textW);
      const step = Math.max(1, consultantScrollH - 1);
      if (key.pageUp) {
        setOverlay({
          ...overlay,
          scroll: Math.max(0, overlay.scroll - step),
        });
      }
      if (key.pageDown) {
        setOverlay({
          ...overlay,
          scroll: Math.min(maxScroll, overlay.scroll + step),
        });
      }
    },
    { isActive: overlayActive && overlay?.k === 'consultant-view' },
  );

  // Esc from done overlay -> dismiss and reload
  useInput(
    (_input, key) => {
      if (!overlayActive || overlay?.k !== 'done') {
        return;
      }
      if (key.escape) {
        reloadEditorAfterOverlaySave();
      }
    },
    { isActive: overlayActive && overlay?.k === 'done' },
  );

  // ---------------------------------------------------------------------------
  // JSX rendering
  // ---------------------------------------------------------------------------

  if (snapshot.loading) {
    return <Text dimColor>Loading profile…</Text>;
  }

  if (snapshot.error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{snapshot.error}</Text>
        <Text dimColor>Profile dir: {profileDir}</Text>
      </Box>
    );
  }

  // ---------------------------------------------------------------------------
  // Overlay rendering function
  // ---------------------------------------------------------------------------
  const renderOverlay = (): React.ReactNode => {
    if (overlay == null) return null;

    switch (overlay.k) {
      case 'gen-questions':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Generating questions…" />
          </Box>
        );

      case 'qa': {
        const q = overlay.questions[overlay.index];
        if (!q) {
          return (
            <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
              <Spinner label="Starting apply…" />
            </Box>
          );
        }
        const labelW = Math.max(16, textW - 16);
        const qaItems = overlay.questions.map((qq, i) => ({
          value: String(i),
          label: `${i + 1}. ${truncateForPanel(qq.question, labelW)}${
            qaAnswers[qq.id]?.trim() ? ' (answered)' : ''
          }`,
        }));
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Q&A from source</Text>
            <Text dimColor>
              {overlay.questions.length} question{overlay.questions.length === 1 ? '' : 's'} · Shift+Tab
              switches question list / answer field · In the list, arrow up/down move · Enter opens the answer
              field
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text bold={qaListFocus} dimColor={!qaListFocus}>
                Questions {qaListFocus ? '(focused)' : '(Shift+Tab)'}
              </Text>
              <SelectList
                items={qaItems}
                selectedIndex={overlay.index}
                onChange={(i) => {
                  if (overlay.k !== 'qa') return;
                  const oldQ = overlay.questions[overlay.index];
                  const merged = { ...qaAnswers };
                  if (oldQ) {
                    merged[oldQ.id] = qaAnswerDraft.trim();
                  }
                  const newQ = overlay.questions[i];
                  setQaAnswers(merged);
                  setQaAnswerDraft(newQ ? (merged[newQ.id] ?? '') : '');
                  setOverlay({ ...overlay, index: i });
                }}
                isActive={overlayActive && qaListFocus}
                onSubmit={() => {
                  setQaListFocus(false);
                }}
              />
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text bold>Question {overlay.index + 1}</Text>
              <Text dimColor>{q.context}</Text>
              <Text>{q.question}</Text>
              <TextInput
                value={qaAnswerDraft}
                onChange={setQaAnswerDraft}
                focus={overlayActive && !qaListFocus}
                onSubmit={(v) => {
                  if (overlay.k !== 'qa') return;
                  const next = { ...qaAnswers, [q.id]: v.trim() };
                  setQaAnswers(next);
                  if (overlay.index + 1 >= overlay.questions.length) {
                    setQaAnswerDraft('');
                    void overlayRunApply(next);
                  } else {
                    const ni = overlay.index + 1;
                    const nq = overlay.questions[ni];
                    setOverlay({ ...overlay, index: ni });
                    setQaAnswerDraft(nq ? (next[nq.id] ?? '') : '');
                  }
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'qa-apply':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Applying refinements…" />
          </Box>
        );

      case 'polish-pick': {
        const polishItems = [
          ...REFINE_SECTION_MENU_ROWS.map((r) => ({
            value: r.id,
            label: r.polishLabel,
          })),
          { value: 'back' as const, label: '← Back' },
        ];
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Polish — pick sections</Text>
            <Box marginTop={1}>
              <SelectList
                items={polishItems}
                selectedIndex={polishMenuIdx}
                onChange={(i) => setPolishMenuIdx(i)}
                isActive={overlayActive}
                onSubmit={(item) => {
                  if (item.value === 'back') {
                    dismissOverlay();
                    return;
                  }
                  const row = REFINE_SECTION_MENU_ROWS.find((r) => r.id === item.value);
                  if (!row) return;
                  void overlayRunPolish([...row.polishSections]);
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'polish-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Polishing profile…" />
          </Box>
        );

      case 'sniff-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Running AI sniff pass (humanizing phrasing)…" />
          </Box>
        );

      case 'direct-edit-input':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1} flexGrow={1}>
            <Text bold>Direct edit — instructions to Claude</Text>
            <Box marginTop={1} flexGrow={1}>
              <MultilineInput
                value={directEditDraft}
                onChange={setDirectEditDraft}
                focus={overlayActive}
                width={textW}
                height={directEditViewportH}
                onSubmit={(text) => {
                  const t = text.trim();
                  if (!t) return;
                  void overlayRunDirectEdit(t);
                }}
              />
            </Box>
          </Box>
        );

      case 'direct-edit-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Applying direct edit…" />
          </Box>
        );

      case 'consultant-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Running hiring-manager review…" />
          </Box>
        );

      case 'consultant-section-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Running section-scoped hiring-manager review…" />
          </Box>
        );

      case 'consultant-questions-run':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Checking which suggestions need details from you…" />
          </Box>
        );

      case 'consultant-apply':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Applying consultant suggestions to profile…" />
          </Box>
        );

      case 'consultant-feedback-qa': {
        const q = overlay.questions[overlay.index];
        const finding = q ? overlay.findings[q.findingIndex] : undefined;
        if (!q || !finding) {
          return (
            <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
              <Spinner label="Applying consultant suggestions…" />
            </Box>
          );
        }
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>
              Consultant follow-up {overlay.index + 1}/{overlay.questions.length}
            </Text>
            <Text dimColor>{finding.area}</Text>
            <Text dimColor>{finding.suggestion}</Text>
            <Box marginTop={1}>
              <Text>{q.question}</Text>
              <TextInput
                value={consultantFbDraft}
                onChange={setConsultantFbDraft}
                focus={overlayActive}
                onSubmit={(v) => {
                  if (overlay.k !== 'consultant-feedback-qa') return;
                  const trimmed = v.trim();
                  if (trimmed) {
                    consultantFbAnswersRef.current.set(q.findingIndex, trimmed);
                  }
                  setConsultantFbDraft('');
                  if (overlay.index + 1 >= overlay.questions.length) {
                    const merged = mergeConsultantFindingAnswers(
                      overlay.findings,
                      new Map(consultantFbAnswersRef.current),
                    );
                    void overlayRunConsultantApplyWithFindings(merged);
                  } else {
                    setOverlay({ ...overlay, index: overlay.index + 1 });
                  }
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'consultant-pick':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
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
                  isActive={overlayActive}
                  onConfirm={() => {
                    const w = consultantWorkRef.current;
                    if (!w) return;
                    const checkedIdx = consultantCheckboxItems
                      .filter((it) => it.checked)
                      .map((it) => Number.parseInt(it.value, 10))
                      .filter(
                        (i) => !Number.isNaN(i) && i >= 0 && i < w.evaluation.improvements.length,
                      );
                    if (checkedIdx.length === 0) return;
                    checkedIdx.sort((a, b) => a - b);
                    const selected = checkedIdx
                      .map((i) => w.evaluation.improvements[i])
                      .filter((f): f is ConsultantFinding => f != null);
                    void overlayRunConsultantEnrichAndApply(selected);
                  }}
                />
              )}
            </Box>
          </Box>
        );

      case 'consultant-view': {
        const consultantRows = linesToWrappedRows(overlay.previewLines, textW);
        const consultantItems = [
          ...(overlay.evaluation.improvements.length > 0
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
          { value: 'back' as const, label: '← Back to editor' },
        ];
        const scoped = overlay.sectionScopeLabel != null;
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>{scoped ? 'Section consultant review' : 'Professional consultant review'}</Text>
            <Text dimColor>
              {scoped
                ? `Feedback scoped to ${overlay.sectionScopeLabel}. PgUp/PgDn scrolls; arrow keys move actions.`
                : 'Overall feedback on your refined profile. PgUp/PgDn scrolls; arrow keys move actions.'}
            </Text>
            <Box marginTop={1} flexGrow={1}>
              <TextViewport
                panelWidth={panelW}
                viewportHeight={consultantScrollH}
                scrollOffset={overlay.scroll}
                totalRows={consultantRows.length}
                kind="Consultant review"
              >
                <ScrollView
                  displayLines={consultantRows}
                  height={consultantScrollH}
                  scrollOffset={overlay.scroll}
                  padToWidth={textW}
                />
              </TextViewport>
            </Box>
            <Box marginTop={1}>
              <SelectList
                items={consultantItems}
                selectedIndex={consultantMenuIdx}
                onChange={(i) => setConsultantMenuIdx(i)}
                isActive={overlayActive}
                onSubmit={(item) => {
                  if (overlay.k !== 'consultant-view') return;
                  if (item.value === 'apply-all') {
                    void overlayRunConsultantEnrichAndApply(overlay.evaluation.improvements);
                    return;
                  }
                  if (item.value === 'apply-pick') {
                    const imps = overlay.evaluation.improvements;
                    setConsultantCheckboxItems(
                      imps.map((f, i) => ({
                        value: String(i),
                        label: truncateForPanel(`${f.area}: ${f.issue}`, Math.max(24, textW - 8)),
                        checked: true,
                      })),
                    );
                    setConsultantPickFocusIdx(0);
                    setOverlay({ k: 'consultant-pick' });
                    return;
                  }
                  consultantWorkRef.current = null;
                  consultantPendingFindingsRef.current = null;
                  consultantEnrichFindingsRef.current = null;
                  dismissOverlay();
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'diff': {
        const blocks = computeRefinementDiff(overlay.original, overlay.proposed);
        const diffItems = [
          { value: 'accept', label: 'Accept and save refined profile' },
          { value: 'edit-summary', label: 'Edit proposed summary (then review diff again)' },
          { value: 'discard', label: 'Discard — keep profile unchanged' },
        ];
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Review changes</Text>
            <DiffView blocks={blocks} />
            <Box marginTop={1}>
              <SelectList
                items={diffItems}
                selectedIndex={overlayDiffSelectIdx}
                onChange={(i) => setOverlayDiffSelectIdx(i)}
                isActive={overlayActive}
                onSubmit={(item) => {
                  if (overlay.k !== 'diff') return;
                  if (item.value === 'accept') {
                    if (overlay.saveMode === 'keep-session') {
                      void overlayPersistRefinedKeepSession(
                        overlay.proposed,
                        overlay.keepSessionReason ?? 'unspecified',
                      );
                    } else {
                      void overlayPersistRefined(overlay.proposed, qaQuestions, qaAnswers);
                    }
                  } else if (item.value === 'discard') {
                    setOverlay({ k: 'done', note: 'Discarded — profile unchanged.' });
                  } else if (item.value === 'edit-summary') {
                    setOverlaySummaryTweakDraft(overlay.proposed.summary?.value ?? '');
                    setOverlay({
                      k: 'diff-edit-summary',
                      original: overlay.original,
                      proposed: overlay.proposed,
                      saveMode: overlay.saveMode,
                      keepSessionReason: overlay.keepSessionReason,
                    });
                  }
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'diff-edit-summary':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Edit proposed summary</Text>
            <Box marginTop={1}>
              <TextInput
                value={overlaySummaryTweakDraft}
                onChange={setOverlaySummaryTweakDraft}
                focus={overlayActive}
                onSubmit={() => {
                  if (overlay.k !== 'diff-edit-summary') return;
                  const next = cloneProfile(overlay.proposed);
                  const t = overlaySummaryTweakDraft.trim();
                  if (t) {
                    next.summary = userEditSourced(t);
                  } else {
                    delete next.summary;
                  }
                  setOverlay({
                    k: 'diff',
                    original: overlay.original,
                    proposed: next,
                    saveMode: overlay.saveMode ?? 'qa',
                    keepSessionReason: overlay.keepSessionReason,
                  });
                }}
              />
            </Box>
          </Box>
        );

      case 'history-list': {
        const listItems = [
          ...overlay.entries.map((e) => ({
            value: `snap:${e.id}`,
            label: `${e.id} · ${e.savedAt} · ${e.reason}`,
          })),
          { value: 'back', label: '← Back to editor' },
        ];
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Refinement history</Text>
            <Text dimColor>
              Snapshots are saved automatically when refined.json changes. Restore replaces current
              refined.json and refined.md.
            </Text>
            {overlay.warnings.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                {overlay.warnings.map((w) => (
                  <Text key={w} color="yellow">
                    {w}
                  </Text>
                ))}
              </Box>
            )}
            {overlay.entries.length === 0 && (
              <Box marginTop={1}>
                <Text dimColor>No snapshots yet (appears after the second save of refined data).</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <SelectList
                items={listItems}
                selectedIndex={historyMenuIdx}
                onChange={(i) => setHistoryMenuIdx(i)}
                isActive={overlayActive}
                onSubmit={(item) => {
                  if (overlay.k !== 'history-list') return;
                  if (item.value === 'back') {
                    dismissOverlay();
                    return;
                  }
                  const id = item.value.replace(/^snap:/, '');
                  const entry = overlay.entries.find((e) => e.id === id);
                  if (!entry) return;
                  setOverlay({
                    k: 'history-confirm',
                    entry,
                    list: { entries: overlay.entries, warnings: overlay.warnings },
                  });
                }}
              />
            </Box>
          </Box>
        );
      }

      case 'history-confirm':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Restore snapshot?</Text>
            <Text>
              id {overlay.entry.id} · {overlay.entry.savedAt} · {overlay.entry.reason}
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
                active={overlayActive}
                onConfirm={() => {
                  if (overlay.k !== 'history-confirm') return;
                  void overlayRunRestoreFromHistory(overlay.entry);
                }}
                onCancel={() => {
                  if (overlay.k !== 'history-confirm') return;
                  setOverlay({
                    k: 'history-list',
                    entries: overlay.list.entries,
                    warnings: overlay.list.warnings,
                  });
                }}
              />
            </Box>
          </Box>
        );

      case 'syncing-md':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Syncing refined.json from refined.md…" />
          </Box>
        );

      case 'saving':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Spinner label="Saving…" />
          </Box>
        );

      case 'done':
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold color="green">
              {overlay.note}
            </Text>
            <Text dimColor>Esc to return to editor</Text>
          </Box>
        );

      case 'err': {
        const showSettings = apiFailureStreak >= 3;
        const errItems = [
          { value: 'retry' as const, label: 'Retry' },
          ...(showSettings
            ? [{ value: 'settings' as const, label: 'Check Settings (API key / provider)' }]
            : []),
          {
            value: 'back' as const,
            label:
              overlay.retryKind === 'apply'
                ? 'Back to last question'
                : overlay.retryKind === 'consultant' && consultantWorkRef.current
                  ? 'Back to consultant review'
                  : 'Back to editor',
          },
        ];
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Error</Text>
            <Text color="red">{overlay.msg}</Text>
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
                isActive={overlayActive}
                onSubmit={(item) => {
                  if (overlay.k !== 'err') return;
                  if (item.value === 'settings') {
                    setApiFailureStreak(0);
                    navigate('settings');
                    dispatch({ type: 'SET_FOCUS', target: 'content' });
                    return;
                  }
                  if (item.value === 'back') {
                    setApiFailureStreak(0);
                    if (overlay.retryKind === 'apply') {
                      setQaListFocus(false);
                      setOverlay({ k: 'qa', questions: qaQuestions, index: Math.max(0, qaQuestions.length - 1) });
                      return;
                    }
                    if (overlay.retryKind === 'consultant') {
                      const w = consultantWorkRef.current;
                      if (w) {
                        setConsultantMenuIdx(0);
                        setOverlay({
                          k: 'consultant-view',
                          evaluation: w.evaluation,
                          previewLines: formatProfileEvaluationLines(
                            w.evaluation,
                            w.sectionScopeLabel ? { sectionScope: w.sectionScopeLabel } : undefined,
                          ),
                          scroll: 0,
                          sectionScopeLabel: w.sectionScopeLabel,
                        });
                        return;
                      }
                    }
                    if (overlay.retryKind === 'consultant-section') {
                      lastConsultantSectionLabelRef.current = null;
                    }
                    dismissOverlay();
                    return;
                  }
                  if (item.value === 'retry') {
                    setErrMenuIdx(0);
                    if (overlay.retryKind === 'gen-questions') {
                      void overlayBeginQaFlow();
                    } else if (overlay.retryKind === 'apply') {
                      void overlayRunApply();
                    } else if (overlay.retryKind === 'save') {
                      const kp = persistKeepRef.current;
                      if (kp) {
                        void overlayPersistRefinedKeepSession(kp, persistKeepReasonRef.current);
                      } else {
                        const ctx = persistCtxRef.current;
                        if (ctx) {
                          void overlayPersistRefined(ctx.profile, ctx.qs, ctx.ans);
                        }
                      }
                    } else if (overlay.retryKind === 'sync') {
                      void overlaySyncRefinedFromMarkdown();
                    } else if (overlay.retryKind === 'polish') {
                      void overlayRunPolish(lastPolishSectionsRef.current, {
                        positionIds: lastPolishPositionIdsRef.current,
                      });
                    } else if (overlay.retryKind === 'ai-sniff') {
                      void overlayRunAiSniff();
                    } else if (overlay.retryKind === 'consultant') {
                      const w = consultantWorkRef.current;
                      const pending = consultantPendingFindingsRef.current;
                      const enrichStash = consultantEnrichFindingsRef.current;
                      if (w && pending && pending.length > 0) {
                        void overlayRunConsultantApplyWithFindings(pending);
                      } else if (w && enrichStash && enrichStash.length > 0) {
                        void overlayRunConsultantEnrichAndApply(enrichStash);
                      } else if (w && w.evaluation.improvements.length > 0) {
                        void overlayRunConsultantEnrichAndApply(w.evaluation.improvements);
                      } else {
                        void overlayRunConsultantReview();
                      }
                    } else if (overlay.retryKind === 'consultant-section') {
                      const lab = lastConsultantSectionLabelRef.current;
                      if (lab) {
                        void overlayRunConsultantSectionReview(lab);
                      } else {
                        dismissOverlay();
                      }
                    } else {
                      void overlayRunDirectEdit(lastDirectInstructionsRef.current);
                    }
                  }
                }}
              />
            </Box>
          </Box>
        );
      }

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {snapshot.hasSource &&
        loadedProfile != null &&
        snapshot.hasRefined &&
        editorBundle == null && (
          <Box marginBottom={1}>
            <Text dimColor>Loading refined resume…</Text>
          </Box>
        )}
      {snapshot.hasSource && loadedProfile != null && editorMode && editorBundle != null && (
        <Box
          ref={resumeEditorHostRef}
          marginBottom={1}
          flexGrow={1}
          flexDirection="column"
          minHeight={0}
        >
          {mode === 'job' && jobDescription && (
            <JdPane
              jobDescription={jobDescription}
              mode={jdPaneMode}
              peekHeight={Math.floor(termRows / 3)}
              fullHeight={viewportH}
              isActive={panelActive && jdPaneMode === 'full'}
            />
          )}
          {jdPaneMode !== 'full' && (
            <Box flexDirection="column" flexGrow={1} minHeight={0}>
              <EditorHint isFocused={resumeBodyFocused} sectionLabel={activeSectionLabel} />
              {parseErr != null && (
                <Box marginBottom={1}>
                  <Text color="red" wrap="truncate-end">
                    {parseErr}
                  </Text>
                </Box>
              )}
              <FreeCursorMultilineInput
                value={mdDraft}
                geometryTie={`${!api}-${parseErr ?? ''}-${resumeEditorLineSlots}`}
                externalContentRevision={mdExternalRevision}
                onChange={(v) => {
                  mdDirtyRef.current = true;
                  dispatch({ type: 'SET_EDITOR_DIRTY', value: true });
                  setMdDraft(v);
                }}
                focus={panelActive && !docMenuOpen && docPolishDiff == null && overlay == null && resumeBodyFocused}
                width={textW}
                height={resumeEditorLineSlots}
                jumpToChar={jumpToChar}
                onConsumedJumpToChar={() => {
                  setJumpToChar(null);
                }}
                onCaretOffsetChange={setCaretOffset}
                onSubmit={(v) => {
                  setMdDraft(v);
                  try {
                    const p = parseDisplayMarkdownStringToProfile(v, editorBundle.profile);
                    setParseErr(null);
                    void persistEditorProfile(p);
                  } catch (e: unknown) {
                    setParseErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            </Box>
          )}
        </Box>
      )}
      {snapshot.hasSource &&
        loadedProfile != null &&
        !snapshot.hasRefined &&
        mdDisplayRows.length > 0 && (
          <Box marginBottom={1} flexGrow={1} flexDirection="column" minHeight={0}>
            <TextViewport
              panelWidth={panelW}
              viewportHeight={viewportH}
              scrollOffset={mdScrollClamped}
              totalRows={mdDisplayRows.length}
              kind="Resume (read-only)"
            >
              <ScrollView
                rowElements={mdRowElements}
                height={viewportH}
                scrollOffset={mdScrollClamped}
                padToWidth={textW}
              />
            </TextViewport>
          </Box>
        )}
      {snapshot.hasSource && loadedProfile != null && docPolishDiff != null && (
        <Box marginBottom={1} flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Polish preview</Text>
          <DiffView blocks={polishDiffBlocks} />
          <SelectList
            items={[
              { value: 'accept', label: 'Accept and save' },
              { value: 'discard', label: 'Discard' },
            ]}
            selectedIndex={polishDiffSelectIdx}
            onChange={(i) => {
              setPolishDiffSelectIdx(i);
            }}
            isActive={panelActive && docPolishDiff != null}
            onSubmit={async (item) => {
              if (item.value === 'discard' || docPolishDiff == null) {
                setDocPolishDiff(null);
                return;
              }
              const { proposed } = docPolishDiff;
              if (editorBundle == null) {
                setDocPolishDiff(null);
                return;
              }
              try {
                await saveRefinedForPersistenceTarget(persistenceTarget, {
                  profile: proposed,
                  session: editorBundle.session,
                  profileDir,
                });
                setEditorBundle((b) => (b ? { ...b, profile: proposed } : null));
                setMdDraft(stripHtmlCommentsFromProfileMarkdown(profileMarkdownContent(proposed)));
                setMdExternalRevision((n) => n + 1);
                mdDirtyRef.current = false;
                dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
                setDocPolishDiff(null);
                onRefreshSnapshot?.();
              } catch (e: unknown) {
                setParseErr(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </Box>
      )}
      {snapshot.hasSource && loadedProfile != null && docMenuOpen && (
        <Box marginBottom={1} flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{outlineOpen ? 'Outline (jump)' : 'Section actions'}</Text>
          {outlineOpen ? (
            <SelectList
              items={outlineItems}
              selectedIndex={outlineIdx}
              onChange={(i) => {
                setOutlineIdx(i);
              }}
              isActive={panelActive && outlineOpen}
              onSubmit={(item) => {
                const entry = sectionEntries.find((e) => e.id === item.value);
                if (editorMode && entry != null) {
                  const li = findDisplayRowForSection(mdDraft.split('\n'), entry);
                  if (li != null) {
                    setJumpToChar({
                      nonce: Date.now(),
                      offset: offsetAtLineCol(mdDraft, li, 0),
                    });
                  }
                } else {
                  const row = sectionScrollMap.get(item.value as ResumeSectionId);
                  if (row !== undefined) {
                    setMdScroll(() => Math.min(Math.max(row, 0), mdMaxScroll));
                  }
                }
                setOutlineOpen(false);
              }}
            />
          ) : (
            <SelectList
              items={headingActionItems}
              selectedIndex={headingMenuIdx}
              onChange={(i) => {
                setHeadingMenuIdx(i);
              }}
              isActive={panelActive && headingMenuEntry != null}
              onSubmit={(item) => {
                if (item.value === 'cancel' || headingMenuEntry == null) {
                  setHeadingMenuEntry(null);
                  return;
                }
                const e = headingMenuEntry;
                if (!isRefinableSectionId(e.id)) {
                  setHeadingMenuEntry(null);
                  return;
                }
                if (item.value === 'polish') {
                  // Launch overlay polish for this section
                  setHeadingMenuEntry(null);
                  const row = REFINE_SECTION_MENU_ROWS.find((r) => r.id === e.id);
                  if (row) {
                    setResumeBodyFocused(false);
                    void overlayRunPolish([...row.polishSections]);
                  }
                } else if (item.value === 'consultant') {
                  // Launch overlay consultant for this section
                  setHeadingMenuEntry(null);
                  const sectionLabel = e.id === 'summary' ? 'Summary' : e.id === 'experience' ? 'Experience' : 'Skills';
                  setResumeBodyFocused(false);
                  void overlayRunConsultantSectionReview(sectionLabel);
                } else {
                  setHeadingMenuEntry(null);
                }
              }}
            />
          )}
        </Box>
      )}
      {/* Overlay rendering — below editor, above profile load error */}
      {overlay != null && renderOverlay()}
      {snapshot.hasSource && profileLoadErr != null && (
        <Box marginBottom={1}>
          <Text color="yellow">Could not load profile for preview: {profileLoadErr}</Text>
        </Box>
      )}
    </Box>
  );
}
