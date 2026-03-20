import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { markdownToProfile, profileToMarkdown } from '../../profile/markdown.ts';
import type {
  Profile,
  RefinementQuestion,
  RefinementSession,
  Sourced,
} from '../../profile/schema.ts';
import {
  hashSource,
  isMdNewerThanJson,
  loadRefined,
  loadSource,
  refinedJsonPath,
  refinedMdPath,
  saveRefined,
} from '../../profile/serializer.ts';
import {
  applyDirectEdit,
  applyRefinements,
  computeRefinementDiff,
  generateRefinementQuestions,
  polishProfile,
} from '../../services/refine.ts';
import { fileExists } from '../../utils/fs.ts';
import {
  ConfirmPrompt,
  DiffView,
  MultilineInput,
  SelectList,
  Spinner,
  TextInput,
} from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { isUserAbort } from '../isUserAbort.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';

function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

function userEditSourced(value: string): Sourced<string> {
  const now = new Date().toISOString();
  return { value, source: { kind: 'user-edit', editedAt: now } };
}

type Phase =
  | { k: 'loading' }
  | { k: 'no-source'; msg: string }
  | { k: 'has-refined-menu'; syncPrompt: boolean }
  | { k: 'syncing-md' }
  | { k: 'gen-questions' }
  | { k: 'qa'; questions: RefinementQuestion[]; index: number }
  | { k: 'apply' }
  | { k: 'diff'; original: Profile; proposed: Profile; diffSaveMode?: 'qa' | 'keep-session' }
  | {
      k: 'diff-edit-summary';
      original: Profile;
      proposed: Profile;
      diffSaveMode?: 'qa' | 'keep-session';
    }
  | { k: 'polish-pick' }
  | { k: 'polish-run'; sections: string[] }
  | { k: 'direct-edit-input' }
  | { k: 'direct-edit-run'; instructions: string }
  | { k: 'saving' }
  | { k: 'done'; note: string }
  | {
      k: 'err';
      msg: string;
      retryKind: 'gen-questions' | 'apply' | 'save' | 'sync' | 'polish' | 'direct-edit';
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
  const [autoStartQa, setAutoStartQa] = useState(false);
  const [questions, setQuestions] = useState<RefinementQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerDraft, setAnswerDraft] = useState('');
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
  const lastPolishSectionsRef = useRef<string[]>([]);
  const lastDirectInstructionsRef = useRef('');
  const [directEditDraft, setDirectEditDraft] = useState('');
  const [polishMenuIdx, setPolishMenuIdx] = useState(0);

  const active = activeScreen === 'refine' && focusTarget === 'content';

  useEffect(() => {
    if (phase.k === 'diff') {
      setDiffSelectIdx(0);
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
        });
      }
    },
    { isActive: active && phase.k === 'diff-edit-summary' },
  );

  useInput(
    (_input, key) => {
      if (!active || inTextInput) {
        return;
      }
      if (key.escape && (phase.k === 'polish-pick' || phase.k === 'direct-edit-input')) {
        setPhase({ k: 'has-refined-menu', syncPrompt: false });
      }
    },
    { isActive: active && (phase.k === 'polish-pick' || phase.k === 'direct-edit-input') },
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
        await saveRefined({ profile, session }, profileDir);
        await profileToMarkdown(profile, refinedMdPath(profileDir));
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
    async (profile: Profile) => {
      persistKeepRef.current = profile;
      persistCtxRef.current = null;
      setPhase({ k: 'saving' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadRefined(profileDir);
        await saveRefined({ profile, session: existing.session }, profileDir);
        await profileToMarkdown(profile, refinedMdPath(profileDir));
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
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
      await saveRefined({ profile: updatedProfile, session: existing.session }, profileDir);
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
        await saveRefined({ profile: source, session }, profileDir);
        await profileToMarkdown(source, refinedMdPath(profileDir));
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
        setApiFailureStreak(0);
        setPhase({ k: 'done', note: 'No gaps found — saved source as refined (no edits).' });
        return;
      }
      setAnswers({});
      setAnswerDraft('');
      setApiFailureStreak(0);
      setPhase({ k: 'qa', questions: qs, index: 0 });
    } catch (e) {
      if (isUserAbort(e)) {
        setPhase({ k: 'has-refined-menu', syncPrompt: false });
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
  }, [createController, dispatch, profileDir, releaseController, source]);

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
          setAutoStartQa(true);
        }
      } catch (e) {
        setPhase({ k: 'no-source', msg: (e as Error).message });
      }
    })();
  }, [profileDir]);

  useEffect(() => {
    if (autoStartQa && source) {
      setAutoStartQa(false);
      void beginQaFlow();
    }
  }, [autoStartQa, source, beginQaFlow]);

  const runApply = useCallback(async () => {
    if (!source) {
      return;
    }
    const ac = createController();
    setPhase({ k: 'apply' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const proposed = await applyRefinements(source, questions, answers, ac.signal);
      const blocks = computeRefinementDiff(source, proposed);
      if (blocks.length === 0) {
        await persistRefined(proposed, questions, answers);
        return;
      }
      setApiFailureStreak(0);
      setPhase({ k: 'diff', original: source, proposed, diffSaveMode: 'qa' });
    } catch (e) {
      if (isUserAbort(e)) {
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
  }, [answers, createController, dispatch, persistRefined, questions, releaseController, source]);

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
          await persistRefinedKeepSession(proposed);
          return;
        }
        setPhase({
          k: 'diff',
          original: base,
          proposed,
          diffSaveMode: 'keep-session',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          setPhase({ k: 'has-refined-menu', syncPrompt: false });
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
      persistRefinedKeepSession,
      profileDir,
      releaseController,
    ],
  );

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
          await persistRefinedKeepSession(proposed);
          return;
        }
        setPhase({
          k: 'diff',
          original: base,
          proposed,
          diffSaveMode: 'keep-session',
        });
      } catch (e) {
        if (isUserAbort(e)) {
          setPhase({ k: 'has-refined-menu', syncPrompt: false });
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
    [createController, dispatch, persistRefinedKeepSession, profileDir, releaseController],
  );

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
        <Text dimColor>Import a profile first (Import screen).</Text>
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
        <Text dimColor>Expert pass on selected sections · Esc back via menu</Text>
        <Box marginTop={1}>
          <SelectList
            items={polishItems}
            selectedIndex={polishMenuIdx}
            onChange={(i) => setPolishMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'back') {
                setPhase({ k: 'has-refined-menu', syncPrompt: false });
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

  if (phase.k === 'direct-edit-input') {
    return (
      <Box flexDirection="column">
        <Text bold>Refine — direct edit</Text>
        <Text dimColor>Describe changes (Ctrl+D submit) · Esc → back to menu</Text>
        <Box marginTop={1}>
          <MultilineInput
            value={directEditDraft}
            onChange={setDirectEditDraft}
            focus={active}
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

  if (phase.k === 'has-refined-menu') {
    const items = [
      { value: 'start', label: 'Run Q&A from source (new refinement pass)' },
      { value: 'polish', label: 'Polish sections (AI)' },
      { value: 'direct', label: 'Direct edit (instructions to Claude)' },
      { value: 'jobs', label: 'Prepare for a job → open Jobs' },
      { value: 'cancel', label: 'Stay — use sidebar to navigate away' },
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
                  setPhase({ k: 'has-refined-menu', syncPrompt: false });
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
              if (item.value === 'direct') {
                setDirectEditDraft('');
                setPhase({ k: 'direct-edit-input' });
                return;
              }
              if (item.value === 'jobs') {
                navigate('jobs');
                dispatch({ type: 'SET_FOCUS', target: 'content' });
              }
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
    return (
      <Box flexDirection="column">
        <Text bold>
          Question {phase.index + 1}/{phase.questions.length}
        </Text>
        <Text dimColor>{q.context}</Text>
        <Text>{q.question}</Text>
        <Text dimColor>Enter submit · optional: leave blank</Text>
        <TextInput
          value={answerDraft}
          onChange={setAnswerDraft}
          focus={active}
          onSubmit={(v) => {
            const next = { ...answers, [q.id]: v.trim() };
            setAnswers(next);
            setAnswerDraft('');
            if (phase.index + 1 >= phase.questions.length) {
              void runApply();
            } else {
              setPhase({ ...phase, index: phase.index + 1 });
            }
          }}
        />
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
          <Text dimColor>↑↓ choose action · Enter confirm (or edit summary, then return here)</Text>
        </Box>
        <Box marginTop={1}>
          <SelectList
            items={diffItems}
            selectedIndex={diffSelectIdx}
            onChange={(i) => setDiffSelectIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'accept') {
                if (phase.diffSaveMode === 'keep-session') {
                  void persistRefinedKeepSession(phase.proposed);
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
        <Text dimColor>Enter applies and returns to diff · Esc cancels (keeps prior proposed)</Text>
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
                setPhase({ k: 'has-refined-menu', syncPrompt: false });
                return;
              }
              if (item.value === 'back') {
                setApiFailureStreak(0);
                if (phase.retryKind === 'apply') {
                  setPhase({ k: 'qa', questions, index: Math.max(0, questions.length - 1) });
                  return;
                }
                setPhase({ k: 'has-refined-menu', syncPrompt: false });
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
                    void persistRefinedKeepSession(kp);
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
