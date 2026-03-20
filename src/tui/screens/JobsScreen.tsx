import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { loadJobs } from '../../profile/serializer.ts';

export interface JobsScreenProps {
  profileDir: string;
}

export function JobsScreen({ profileDir }: JobsScreenProps) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const jobs = await loadJobs(profileDir);
        if (jobs.length === 0) {
          setLines(['(no saved jobs yet — run suited jobs in CLI to add)']);
          return;
        }
        setLines(
          jobs.map(
            (j) => `${j.company} — ${j.title}  (${new Date(j.savedAt).toLocaleDateString()})`,
          ),
        );
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [profileDir]);

  if (err) {
    return <Text color="red">{err}</Text>;
  }

  if (!lines) {
    return <Text dimColor>Loading jobs…</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Saved jobs</Text>
      {lines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Full add/delete UI: run `suited jobs`. Enter here opens jobs CLI.</Text>
      </Box>
    </Box>
  );
}
