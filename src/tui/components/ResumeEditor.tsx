import { Box, type DOMElement, measureElement, Text, useInput } from 'ink';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  parseDisplayMarkdownStringToProfile,
  profileMarkdownContent,
  stripHtmlCommentsFromProfileMarkdown,
} from '../../profile/markdown.ts';
import type { Profile } from '../../profile/schema.ts';
import { loadActiveProfile } from '../../profile/serializer.ts';
import { computeRefinementDiff, polishProfile } from '../../services/refine.ts';
import { validateProfile } from '../../services/validate.ts';
import { EditorHint } from './EditorHint.tsx';
import {
  DiffView,
  FreeCursorMultilineInput,
  ScrollView,
  SelectList,
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
import { loadRefinedTuiState, type RefineTuiLoadedState } from '../refinedPersistenceContext.ts';
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
import { linesToWrappedRows, splitLinesForWrap } from '../utils/wrapTextRows.ts';
import { useValidationState } from '../validationContext.tsx';
import { useResumeEditorContext } from './ResumeEditorContext.tsx';

function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
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
  const { persistenceTarget, onRequestClose } = useResumeEditorContext();
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { activeScreen, inTextInput, paletteOpen } = useAppState();
  const persistenceTargetRef = useRef(persistenceTarget);
  persistenceTargetRef.current = persistenceTarget;
  const { createController, releaseController } = useOperationAbort();
  const panelActive =
    activeScreen === 'dashboard' || activeScreen === 'editor' || activeScreen === 'jobs';
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
        : `Resume · Tab: edit · 1–${SCREEN_ORDER.length} · d i c j r g s · : palette · o / Ctrl+O outline`
      : `Resume · ↑↓ PgUp/PgDn · wheel scroll · o outline · Enter on heading · 1–${SCREEN_ORDER.length} · d i c j r g s · : palette`
    : `Resume · ↑↓ PgUp/PgDn scroll document · 1–${SCREEN_ORDER.length} · d i c j r g s · : palette`;
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
    panelActive && loadedProfile != null && (docMenuOpen || docPolishDiff != null),
  );

  const resumeWheelScrollActive =
    panelActive &&
    loadedProfile != null &&
    !paletteOpen &&
    !docMenuOpen &&
    docPolishDiff == null &&
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
      const experiencePositionId =
        sid === 'experience'
          ? resumeExperiencePositionIdForEditorView(mdDraft, caretOffset, parsed, sectionEntries)
          : undefined;
      dispatch({
        type: 'SET_REFINE_RESUME_INTENT',
        intent: {
          kind: 'consultantSection',
          sectionId: sid,
          ...(experiencePositionId != null ? { positionId: experiencePositionId } : {}),
        },
      });
      navigate('refine');
      mdDirtyRef.current = false;
      dispatch({ type: 'SET_EDITOR_DIRTY', value: false });
    } catch (e: unknown) {
      setParseErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    caretOffset,
    dispatch,
    editorBundle,
    mdDraft,
    navigate,
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
        { value: 'polish', label: 'Polish in Refine' },
        { value: 'consultant', label: 'Section consultant review' },
        { value: 'hub', label: 'Open Refine hub' },
        { value: 'cancel', label: 'Cancel' },
      ];
    }
    return [
      { value: 'hub', label: 'Open Refine hub' },
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
        !editorMode,
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
    { isActive: panelActive && docMenuOpen },
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
        panelActive && editorMode && !docMenuOpen && docPolishDiff == null && resumeBodyFocused,
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
        panelActive && editorMode && !docMenuOpen && docPolishDiff == null && !resumeBodyFocused,
    },
  );

  // Esc in nav mode (no overlay/menu) => close editor
  useInput(
    (_input, key) => {
      if (key.escape && !resumeBodyFocused && !docMenuOpen && docPolishDiff == null) {
        onRequestClose();
      }
    },
    {
      isActive:
        panelActive && editorMode && !resumeBodyFocused && !docMenuOpen && docPolishDiff == null,
    },
  );

  // Outline open + Enter on heading
  useInput(
    (input, key) => {
      if (!panelActive || !resumeDocVisible || docMenuOpen) {
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
      isActive: panelActive && resumeDocVisible && !docMenuOpen && loadedProfile != null,
    },
  );

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
            focus={panelActive && !docMenuOpen && docPolishDiff == null && resumeBodyFocused}
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
                if (item.value === 'hub') {
                  dispatch({ type: 'SET_REFINE_RESUME_INTENT', intent: null });
                  navigate('refine');
                  setHeadingMenuEntry(null);
                  return;
                }
                const e = headingMenuEntry;
                if (!isRefinableSectionId(e.id)) {
                  setHeadingMenuEntry(null);
                  return;
                }
                if (item.value === 'polish') {
                  dispatch({
                    type: 'SET_REFINE_RESUME_INTENT',
                    intent: { kind: 'polishSection', sectionId: e.id },
                  });
                } else if (item.value === 'consultant') {
                  dispatch({
                    type: 'SET_REFINE_RESUME_INTENT',
                    intent: { kind: 'consultantSection', sectionId: e.id },
                  });
                } else {
                  setHeadingMenuEntry(null);
                  return;
                }
                navigate('refine');
                setHeadingMenuEntry(null);
              }}
            />
          )}
        </Box>
      )}
      {snapshot.hasSource && profileLoadErr != null && (
        <Box marginBottom={1}>
          <Text color="yellow">Could not load profile for preview: {profileLoadErr}</Text>
        </Box>
      )}
    </Box>
  );
}
