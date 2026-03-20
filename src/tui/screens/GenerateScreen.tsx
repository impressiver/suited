import { Box, Text } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FlairLevel, SavedJob } from '../../profile/schema.ts';
import { loadJobs } from '../../profile/serializer.ts';
import { runTuiGeneratePdf } from '../../services/generateResume.ts';
import { MultilineInput, SelectList, Spinner } from '../components/shared/index.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

type Phase =
  | { p: 'pick-source' }
  | { p: 'paste' }
  | { p: 'pick-saved'; jobs: SavedJob[]; idx: number }
  | {
      p: 'pick-flair';
      jd?: string;
      jobId?: string;
      title: string;
      company: string;
      idx: number;
    }
  | { p: 'run' }
  | { p: 'done'; path: string }
  | { p: 'err'; msg: string };

const FLAIR_CHOICES: { flair: FlairLevel; label: string }[] = [
  { flair: 1, label: '1 — Classic (ATS-safe, serif)' },
  { flair: 2, label: '2 — Classic+ (minimal accents)' },
  { flair: 3, label: '3 — Modern (accent color)' },
  { flair: 4, label: '4 — Modern+ (bolder accents)' },
  { flair: 5, label: '5 — Bold (sidebar, color block)' },
];

export interface GenerateScreenProps {
  profileDir: string;
}

export function GenerateScreen({ profileDir }: GenerateScreenProps) {
  const dispatch = useAppDispatch();
  const { pendingJobId, activeScreen, focusTarget } = useAppState();
  const [phase, setPhase] = useState<Phase>({ p: 'pick-source' });
  const [pasteBuf, setPasteBuf] = useState('');
  const [sourceIdx, setSourceIdx] = useState(0);

  const active = activeScreen === 'generate' && focusTarget === 'content';

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
      { value: 'paste', label: 'Paste job description' },
      { value: 'saved', label: 'Use a saved job' },
      { value: 'full', label: 'Full resume (no job targeting)' },
    ],
    [],
  );

  const runGenerate = useCallback(
    async (ctx: {
      jd?: string;
      jobId?: string;
      title: string;
      company: string;
      flair: FlairLevel;
    }) => {
      setPhase({ p: 'run' });
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
      try {
        const { outputPath } = await runTuiGeneratePdf({
          profileDir,
          flair: ctx.flair,
          jd: ctx.jd,
          jobId: ctx.jobId,
          jobTitle: ctx.title,
          company: ctx.company,
        });
        setPhase({ p: 'done', path: outputPath });
      } catch (e) {
        setPhase({ p: 'err', msg: (e as Error).message });
      } finally {
        dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
      }
    },
    [dispatch, profileDir],
  );

  if (phase.p === 'run') {
    return (
      <Box flexDirection="column">
        <Text bold>Generate</Text>
        <Spinner label="Building PDF…" />
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
        <Text dimColor>Pick another flow from the sidebar, or g / j to jump screens.</Text>
      </Box>
    );
  }

  if (phase.p === 'err') {
    return (
      <Box flexDirection="column">
        <Text color="red">{phase.msg}</Text>
        <Text dimColor>Esc or choose source again from sidebar after focusing nav.</Text>
      </Box>
    );
  }

  if (phase.p === 'pick-flair') {
    const flairItems = FLAIR_CHOICES.map((c) => ({
      value: String(c.flair),
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
        <Text dimColor>↑↓ flair · Enter generate · Esc → sidebar</Text>
        <Box marginTop={1}>
          <SelectList
            items={flairItems}
            selectedIndex={phase.idx}
            onChange={(i) => setPhase({ ...phase, idx: i })}
            isActive={active}
            onSubmit={(item) => {
              const flair = parseInt(item.value, 10) as FlairLevel;
              void runGenerate({
                jd: phase.jd,
                jobId: phase.jobId,
                title: phase.title,
                company: phase.company,
                flair,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.p === 'paste') {
    return (
      <Box flexDirection="column">
        <Text bold>Paste job description</Text>
        <Text dimColor>Ctrl+D continue · Esc back (via sidebar focus)</Text>
        <MultilineInput
          value={pasteBuf}
          onChange={setPasteBuf}
          focus={active}
          onSubmit={(text) => {
            const t = text.trim();
            if (!t) {
              return;
            }
            setPhase({
              p: 'pick-flair',
              jd: t,
              title: 'Unknown Role',
              company: 'Unknown Company',
              idx: 2,
            });
          }}
        />
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
      <Text dimColor>↑↓ · Enter · Target a job or export everything</Text>
      <Box marginTop={1}>
        <SelectList
          items={sourceItems}
          selectedIndex={sourceIdx}
          onChange={(i) => setSourceIdx(i)}
          isActive={active}
          onSubmit={async (item) => {
            if (item.value === 'paste') {
              setPasteBuf('');
              setPhase({ p: 'paste' });
              return;
            }
            if (item.value === 'saved') {
              const jobs = await loadJobs(profileDir);
              if (jobs.length === 0) {
                setPhase({ p: 'err', msg: 'No saved jobs — add one from Jobs (j).' });
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
