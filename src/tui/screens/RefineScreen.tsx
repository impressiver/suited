import { Box, Text } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import { profileToMarkdown } from '../../profile/markdown.ts';
import type { Profile, RefinementQuestion, RefinementSession } from '../../profile/schema.ts';
import {
  hashSource,
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
import { useAppDispatch, useAppState } from '../store.tsx';

type Phase =
  | { k: 'loading' }
  | { k: 'no-source'; msg: string }
  | { k: 'has-refined-menu' }
  | { k: 'gen-questions' }
  | { k: 'qa'; questions: RefinementQuestion[]; index: number }
  | { k: 'apply' }
  | { k: 'diff'; original: Profile; proposed: Profile }
  | { k: 'saving' }
  | { k: 'done'; note: string }
  | { k: 'err'; msg: string };

export interface RefineScreenProps {
  profileDir: string;
}

export function RefineScreen({ profileDir }: RefineScreenProps) {
  const dispatch = useAppDispatch();
  const { activeScreen, focusTarget } = useAppState();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [source, setSource] = useState<Profile | null>(null);
  const [autoStartQa, setAutoStartQa] = useState(false);
  const [questions, setQuestions] = useState<RefinementQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerDraft, setAnswerDraft] = useState('');
  const [menuIdx, setMenuIdx] = useState(0);

  const active = activeScreen === 'refine' && focusTarget === 'content';

  const persistRefined = useCallback(
    async (profile: Profile, qs: RefinementQuestion[], ans: Record<string, string>) => {
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
        setPhase({ k: 'done', note: 'Refinements saved to refined.json / refined.md' });
      } catch (e) {
        setPhase({ k: 'err', msg: (e as Error).message });
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
    setPhase({ k: 'gen-questions' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const qs = await generateRefinementQuestions(source);
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
        setPhase({ k: 'done', note: 'No gaps found — saved source as refined (no edits).' });
        return;
      }
      setAnswers({});
      setAnswerDraft('');
      setPhase({ k: 'qa', questions: qs, index: 0 });
    } catch (e) {
      setPhase({ k: 'err', msg: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, profileDir, source]);

  useEffect(() => {
    void (async () => {
      try {
        const src = await loadSource(profileDir);
        setSource(src);
        const refined = await fileExists(refinedJsonPath(profileDir));
        if (refined) {
          setPhase({ k: 'has-refined-menu' });
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
    setPhase({ k: 'apply' });
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const proposed = await applyRefinements(source, questions, answers);
      const blocks = computeRefinementDiff(source, proposed);
      if (blocks.length === 0) {
        await persistRefined(proposed, questions, answers);
        return;
      }
      setPhase({ k: 'diff', original: source, proposed });
    } catch (e) {
      setPhase({ k: 'err', msg: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [answers, dispatch, persistRefined, questions, source]);

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
    return (
      <Box flexDirection="column">
        <Text bold>Refine</Text>
        <Text>
          You already have refined data. A new pass uses source.json and replaces refined.json after
          you accept the diff.
        </Text>
        <Box marginTop={1}>
          <SelectList
            items={items}
            selectedIndex={menuIdx}
            onChange={(i) => setMenuIdx(i)}
            isActive={active}
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
    return (
      <Box flexDirection="column">
        <Text bold>Review changes</Text>
        <DiffView blocks={blocks} />
        <Box marginTop={1}>
          <ConfirmPrompt
            message="Accept and save refined profile?"
            active={active}
            onConfirm={() => {
              void persistRefined(phase.proposed, questions, answers);
            }}
            onCancel={() => {
              setPhase({ k: 'done', note: 'Discarded — refined.json unchanged.' });
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
    return (
      <Box flexDirection="column">
        <Text color="red">{phase.msg}</Text>
      </Box>
    );
  }

  return null;
}
