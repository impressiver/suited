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
  applyRefinements,
  computeRefinementDiff,
  generateRefinementQuestions,
} from '../../services/refine.ts';
import { fileExists } from '../../utils/fs.ts';
import {
  ConfirmPrompt,
  DiffView,
  SelectList,
  Spinner,
  TextInput,
} from '../components/shared/index.ts';
import { useOperationAbort } from '../hooks/useOperationAbort.ts';
import { isUserAbort } from '../isUserAbort.ts';
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
  | { k: 'diff'; original: Profile; proposed: Profile }
  | { k: 'diff-edit-summary'; original: Profile; proposed: Profile }
  | { k: 'saving' }
  | { k: 'done'; note: string }
  | {
      k: 'err';
      msg: string;
      retryKind: 'gen-questions' | 'apply' | 'save' | 'sync';
    };

export interface RefineScreenProps {
  profileDir: string;
}

export function RefineScreen({ profileDir }: RefineScreenProps) {
  const dispatch = useAppDispatch();
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
        setPhase({ k: 'diff', original: phase.original, proposed: phase.proposed });
      }
    },
    { isActive: active && phase.k === 'diff-edit-summary' },
  );

  const persistRefined = useCallback(
    async (profile: Profile, qs: RefinementQuestion[], ans: Record<string, string>) => {
      persistCtxRef.current = { profile, qs, ans };
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
      setPhase({ k: 'diff', original: source, proposed });
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

  if (phase.k === 'has-refined-menu') {
    const items = [
      { value: 'start', label: 'Run Q&A from source (new refinement pass)' },
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
                void persistRefined(phase.proposed, questions, answers);
              } else if (item.value === 'discard') {
                setPhase({ k: 'done', note: 'Discarded — refined.json unchanged.' });
              } else if (item.value === 'edit-summary') {
                setSummaryTweakDraft(phase.proposed.summary?.value ?? '');
                setPhase({
                  k: 'diff-edit-summary',
                  original: phase.original,
                  proposed: phase.proposed,
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
              setPhase({ k: 'diff', original: phase.original, proposed: next });
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
                dispatch({ type: 'SET_SCREEN', screen: 'settings' });
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
                  const ctx = persistCtxRef.current;
                  if (ctx) {
                    void persistRefined(ctx.profile, ctx.qs, ctx.ans);
                  }
                } else {
                  void syncRefinedFromMarkdown();
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
