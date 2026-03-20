import { createHash } from 'node:crypto';
import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedJob } from '../../profile/schema.ts';
import { deleteJob, loadJobRefinement, loadJobs, saveJob } from '../../profile/serializer.ts';
import { runJobRefinementPipeline } from '../../services/jobRefinement.ts';
import {
  ConfirmPrompt,
  MultilineInput,
  ScrollView,
  SelectList,
  Spinner,
  TextInput,
} from '../components/shared/index.ts';
import { useTerminalSize } from '../hooks/useTerminalSize.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

const ADD_SENTINEL = '__add__';

type Mode =
  | { m: 'list' }
  | { m: 'detail'; job: SavedJob }
  | { m: 'addTitle' }
  | { m: 'addCompany'; title: string }
  | { m: 'addJd'; title: string; company: string }
  | { m: 'viewJd'; job: SavedJob; scroll: number }
  | { m: 'deleteAsk'; job: SavedJob; from: 'list' | 'detail' }
  | { m: 'prepareRun'; job: SavedJob }
  | { m: 'prepareOk'; job: SavedJob; nPos: number; nSkills: number }
  | { m: 'err'; msg: string };

export interface JobsScreenProps {
  profileDir: string;
}

export function JobsScreen({ profileDir }: JobsScreenProps) {
  const dispatch = useAppDispatch();
  const { activeScreen, focusTarget, inTextInput, operationInProgress } = useAppState();
  const [, rows] = useTerminalSize();

  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [prepLabel, setPrepLabel] = useState<Record<string, string>>({});
  const [listIndex, setListIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ m: 'list' });

  const [titleDraft, setTitleDraft] = useState('');
  const [companyDraft, setCompanyDraft] = useState('');
  const [jdDraft, setJdDraft] = useState('');

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

  const listItems = useMemo(() => {
    const items = jobs.map((j) => ({
      value: j.id,
      label: `${j.title} @ ${j.company}  (${prepLabel[j.id] ?? '…'})`,
    }));
    items.push({ value: ADD_SENTINEL, label: '+ Add new job' });
    return items;
  }, [jobs, prepLabel]);

  const active = activeScreen === 'jobs' && focusTarget === 'content';

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
      (mode.m === 'list' || mode.m === 'detail') &&
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
      dispatch({ type: 'SET_SCREEN', screen: 'generate' });
    },
    [dispatch],
  );

  const runPrepare = useCallback(
    async (job: SavedJob) => {
      setMode({ m: 'prepareRun', job });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const existing = await loadJobRefinement(profileDir, job.id);
        const r = await runJobRefinementPipeline(profileDir, job, existing);
        setMode({
          m: 'prepareOk',
          job,
          nPos: r.plan.selectedPositions.length,
          nSkills: r.plan.selectedSkillIds.length,
        });
        await reload();
      } catch (e) {
        setMode({ m: 'err', msg: (e as Error).message });
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
      if (!active || inTextInput) {
        return;
      }
      if (!key.escape) {
        return;
      }
      if (mode.m === 'viewJd') {
        setMode({ m: 'detail', job: mode.job });
        return;
      }
      if (mode.m === 'deleteAsk') {
        return;
      }
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
      if (mode.m === 'detail') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'prepareOk' || mode.m === 'err') {
        setMode({ m: 'list' });
        return;
      }
      if (mode.m === 'list') {
        dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
      }
    },
    { isActive: active },
  );

  useInput(
    (_input, key) => {
      if (!active || mode.m !== 'viewJd' || inTextInput) {
        return;
      }
      const lines = mode.job.text.split('\n');
      const h = Math.max(4, Math.min(18, rows - 12));
      const maxScroll = Math.max(0, lines.length - h);
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

  const detailMenuItems = useMemo(
    () => [
      { value: 'jd', label: 'View job description' },
      { value: 'prep', label: 'Prepare (curate for this job)' },
      { value: 'gen', label: 'Open Generate with this job' },
      { value: 'del', label: 'Delete this job' },
      { value: 'back', label: '← Back to list' },
    ],
    [],
  );

  const finalizeNewJob = useCallback(
    async (jd: string, title: string, company: string) => {
      const text = jd.trim();
      if (!text) {
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
        setMode({ m: 'err', msg: (e as Error).message });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir, reload],
  );

  if (mode.m === 'prepareRun') {
    return (
      <Box flexDirection="column">
        <Text bold>Jobs</Text>
        <Spinner label={`Preparing ${mode.job.title} @ ${mode.job.company}…`} />
      </Box>
    );
  }

  if (mode.m === 'prepareOk') {
    return (
      <Box flexDirection="column">
        <Text bold>Prepared</Text>
        <Text color="green">
          {mode.job.title} @ {mode.job.company} — {mode.nPos} positions · {mode.nSkills} skills
        </Text>
        <Text dimColor>Esc → list</Text>
      </Box>
    );
  }

  if (mode.m === 'err') {
    return (
      <Box flexDirection="column">
        <Text bold color="red">
          {mode.msg}
        </Text>
        <Text dimColor>Esc → list</Text>
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
    const lines = mode.job.text.split('\n');
    const h = Math.max(4, Math.min(18, rows - 12));
    return (
      <Box flexDirection="column">
        <Text bold>
          JD — {mode.job.title} @ {mode.job.company}
        </Text>
        <Text dimColor>↑↓ scroll · Esc back</Text>
        <ScrollView lines={lines} height={h} scrollOffset={mode.scroll} />
      </Box>
    );
  }

  if (mode.m === 'addTitle') {
    return (
      <Box flexDirection="column">
        <Text bold>Add job — title</Text>
        <Text dimColor>Esc back · Enter next</Text>
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
        <Text dimColor>Esc back · Enter next</Text>
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
      <Box flexDirection="column">
        <Text bold>Add job — description</Text>
        <Text dimColor>Ctrl+D save job · Esc back</Text>
        <MultilineInput
          value={jdDraft}
          onChange={setJdDraft}
          focus={active}
          onSubmit={(text) => {
            void finalizeNewJob(text, mode.title, mode.company);
          }}
        />
      </Box>
    );
  }

  if (mode.m === 'detail') {
    return (
      <Box flexDirection="column">
        <Text bold>
          {mode.job.title} @ {mode.job.company}
        </Text>
        <Text dimColor>↑↓ · Enter · a d g p · Esc list</Text>
        <Box marginTop={1}>
          <SelectList
            items={detailMenuItems}
            selectedIndex={menuIndex}
            onChange={(i) => setMenuIndex(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'jd') {
                setMode({ m: 'viewJd', job: mode.job, scroll: 0 });
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
  }

  return (
    <Box flexDirection="column">
      <Text bold>Saved jobs</Text>
      <Text dimColor>↑↓ · Enter open · a add · d delete · p prepare · g generate</Text>
      <Box marginTop={1}>
        <SelectList
          items={listItems}
          selectedIndex={listIndex}
          onChange={(i) => setListIndex(i)}
          isActive={active && mode.m === 'list'}
          onSubmit={(item) => {
            if (item.value === ADD_SENTINEL) {
              startAdd();
            } else {
              const j = jobs.find((x) => x.id === item.value);
              if (j) {
                setMenuIndex(0);
                setMode({ m: 'detail', job: j });
              }
            }
          }}
        />
      </Box>
    </Box>
  );
}
