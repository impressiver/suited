import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffBlock } from '../../services/refine.ts';
import { profileToRefineText } from '../../claude/prompts/refine.ts';
import { loadActiveProfile } from '../../profile/serializer.ts';
import { generateCoverLetterDraft, lightRefineCoverLetter, sniffCoverLetter } from '../../services/coverLetterAssist.ts';
import { readCoverLetterDraft, saveCoverLetterDraft } from '../../services/coverLetterPdf.ts';
import { DiffView, FreeCursorMultilineInput, SelectList, Spinner } from './shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { panelContentViewportRows, panelFramedTextWidth } from '../panelContentWidth.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch } from '../store.tsx';

type Phase =
  | { k: 'loading' }
  | { k: 'generating' }
  | { k: 'edit' }
  | { k: 'assist' }
  | { k: 'review'; before: string; proposed: string; menuIdx: number }
  | { k: 'err'; msg: string };

export interface CoverLetterEditorProps {
  profileDir: string;
  slug: string;
  company?: string;
  jobTitle?: string;
  jobDescription?: string;
  onClose: () => void;
}

export function CoverLetterEditor({
  profileDir,
  slug,
  company,
  jobTitle,
  jobDescription,
  onClose,
}: CoverLetterEditorProps) {
  const dispatch = useAppDispatch();
  const { createController, releaseController } = useOperationAbort();
  const [termCols, termRows] = useTerminalSize();
  const textW = panelFramedTextWidth(termCols);
  const editorH = panelContentViewportRows(termRows, 12);

  const [draft, setDraft] = useState('');
  const [externalRevision, setExternalRevision] = useState(0);
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [editorFocused, setEditorFocused] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Load draft on mount; if empty, auto-generate from profile + job description
  useEffect(() => {
    let cancelled = false;
    const ac = createController();
    void (async () => {
      const existing = await readCoverLetterDraft(profileDir, slug);
      if (cancelled) return;
      if (existing) {
        setDraft(existing);
        setExternalRevision((n) => n + 1);
        setPhase({ k: 'edit' });
        return;
      }
      // No draft -- generate one from profile + JD
      setPhase({ k: 'generating' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const profile = await loadActiveProfile(profileDir);
        const profileText = profileToRefineText(profile);
        const ctx = { company, jobTitle, jdExcerpt: jobDescription };
        let result = '';
        for await (const ev of generateCoverLetterDraft(profileText, ctx, ac.signal)) {
          if (ev.type === 'done') {
            result = ev.result;
          }
        }
        if (cancelled) return;
        if (result) {
          setDraft(result);
          setExternalRevision((n) => n + 1);
          await saveCoverLetterDraft(profileDir, slug, result);
          setSavedAt(new Date().toLocaleTimeString());
        }
        setPhase({ k: 'edit' });
      } catch (e) {
        if (cancelled) return;
        if (isUserAbort(e)) {
          setPhase({ k: 'edit' });
          return;
        }
        setPhase({ k: 'err', msg: (e as Error).message });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    })();
    return () => {
      cancelled = true;
      releaseController(ac);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [profileDir, slug]);

  const footerHint = useMemo(() => {
    if (phase.k === 'loading') return 'Cover letter · loading…';
    if (phase.k === 'generating') return 'Cover letter · generating draft… · Esc cancel';
    if (phase.k === 'assist') return 'Cover letter · AI working… · Esc cancel';
    if (phase.k === 'review') return 'Cover letter · ↑↓ Enter accept/reject · Esc reject';
    if (phase.k === 'err') return 'Cover letter · Esc back';
    return editorFocused
      ? 'Cover letter · Esc nav mode · Ctrl+S save · : palette'
      : 'Cover letter · Tab edit · r refine · n sniff · s save · Esc close · : palette';
  }, [phase.k, editorFocused]);
  useRegisterPanelFooterHint(footerHint);

  const save = useCallback(async () => {
    try {
      await saveCoverLetterDraft(profileDir, slug, draftRef.current);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setPhase({ k: 'err', msg: (e as Error).message });
    }
  }, [profileDir, slug]);

  const runAssist = useCallback(
    async (kind: 'refine' | 'sniff') => {
      const text = draftRef.current.trim();
      if (!text) {
        setPhase({ k: 'err', msg: 'Cover letter is empty.' });
        return;
      }
      setPhase({ k: 'assist' });
      const ac = createController();
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const ctx = { company, jobTitle, jdExcerpt: jobDescription };
        const gen =
          kind === 'refine'
            ? lightRefineCoverLetter(text, ctx, ac.signal)
            : sniffCoverLetter(text, ctx, ac.signal);
        let proposed = '';
        for await (const ev of gen) {
          if (ev.type === 'done') {
            proposed = ev.result;
          }
        }
        if (!proposed) {
          setPhase({ k: 'edit' });
          return;
        }
        setPhase({ k: 'review', before: draftRef.current, proposed, menuIdx: 0 });
      } catch (e) {
        if (isUserAbort(e)) {
          setPhase({ k: 'edit' });
          return;
        }
        setPhase({ k: 'err', msg: (e as Error).message });
      } finally {
        releaseController(ac);
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [company, createController, dispatch, jobDescription, jobTitle, releaseController],
  );

  // Nav mode keybinds (editor not focused)
  useInput(
    (input, key) => {
      if (key.tab) {
        setEditorFocused(true);
        return;
      }
      if (key.escape) {
        onClose();
        return;
      }
      if (input === 'r' || input === 'R') {
        void runAssist('refine');
        return;
      }
      if (input === 'n' || input === 'N') {
        void runAssist('sniff');
        return;
      }
      if (input === 's' || input === 'S') {
        void save();
      }
    },
    { isActive: phase.k === 'edit' && !editorFocused },
  );

  // Esc from editor body → nav mode
  useInput(
    (_input, key) => {
      if (key.escape) {
        setEditorFocused(false);
      }
    },
    { isActive: phase.k === 'edit' && editorFocused },
  );

  // Ctrl+S from editor body → save
  useInput(
    (input, key) => {
      if (key.ctrl && (input === 's' || input === 'd')) {
        void save();
      }
    },
    { isActive: phase.k === 'edit' && editorFocused },
  );

  // Esc from error → back to edit
  useInput(
    (_input, key) => {
      if (key.escape) {
        setPhase({ k: 'edit' });
      }
    },
    { isActive: phase.k === 'err' },
  );

  if (phase.k === 'loading') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Text bold>
          Cover letter{company && jobTitle ? ` — ${jobTitle} @ ${company}` : ''}
        </Text>
        <Text dimColor>Loading…</Text>
      </Box>
    );
  }

  if (phase.k === 'generating') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Text bold>
          Cover letter{company && jobTitle ? ` — ${jobTitle} @ ${company}` : ''}
        </Text>
        <Box marginTop={1}>
          <Spinner label="Generating cover letter from your profile and job description…" />
        </Box>
      </Box>
    );
  }

  // Review phase rendering & input
  if (phase.k === 'review') {
    const blocks: DiffBlock[] = [{ kind: 'summary', old: phase.before, new: phase.proposed }];
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Text bold>Cover letter — review changes</Text>
        <Text dimColor>↑↓ · Enter · Esc rejects</Text>
        <Box marginTop={1} flexGrow={1} flexDirection="column" minHeight={0}>
          <DiffView blocks={blocks} />
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={[
              { value: 'accept', label: 'Accept and replace draft' },
              { value: 'reject', label: 'Reject' },
            ]}
            selectedIndex={phase.menuIdx}
            onChange={(i) => setPhase((p) => (p.k === 'review' ? { ...p, menuIdx: i } : p))}
            isActive={phase.k === 'review'}
            onSubmit={(item) => {
              if (item.value === 'reject') {
                setPhase({ k: 'edit' });
                return;
              }
              // Accept
              setDraft(phase.proposed);
              setExternalRevision((n) => n + 1);
              void (async () => {
                try {
                  await saveCoverLetterDraft(profileDir, slug, phase.proposed);
                  setSavedAt(new Date().toLocaleTimeString());
                } catch (e) {
                  setPhase({ k: 'err', msg: (e as Error).message });
                  return;
                }
                setPhase({ k: 'edit' });
              })();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'assist') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Text bold>
          Cover letter{company && jobTitle ? ` — ${jobTitle} @ ${company}` : ''}
        </Text>
        <Box marginTop={1}>
          <Spinner label="AI assist…" />
        </Box>
      </Box>
    );
  }

  if (phase.k === 'err') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Text bold>Cover letter</Text>
        <Text color="red">{phase.msg}</Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  // Edit phase — full editor
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold>
            Cover letter{company && jobTitle ? ` — ${jobTitle} @ ${company}` : ''}
          </Text>
        </Box>
        <Box>
          {savedAt && <Text dimColor>Saved {savedAt}</Text>}
          {!editorFocused && (
            <Text dimColor color="cyan">
              {' '}
              r refine · n sniff · s save · Tab edit · Esc close
            </Text>
          )}
        </Box>
      </Box>
      <FreeCursorMultilineInput
        value={draft}
        externalContentRevision={externalRevision}
        onChange={setDraft}
        focus={editorFocused}
        width={textW}
        height={editorH}
        placeholder="Write your cover letter here (Markdown)…"
        onSubmit={(v) => {
          setDraft(v);
          void save();
        }}
      />
    </Box>
  );
}
