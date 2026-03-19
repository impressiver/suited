import { Box, Text } from 'ink';
import { hasApiKey } from '../env.js';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.js';
import { suggestedNextLine } from '../suggestedNext.js';

export interface DashboardScreenProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
}

export function DashboardScreen({ snapshot, profileDir }: DashboardScreenProps) {
  const api = hasApiKey();
  const next = suggestedNextLine({
    hasApiKey: api,
    hasSource: snapshot.hasSource,
    hasRefined: snapshot.hasRefined,
  });

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

  const pipeline = [
    `Source      [${snapshot.hasSource ? '●' : '○'}]`,
    `Refined     [${snapshot.hasRefined ? '●' : '○'}]`,
    `Jobs        [${snapshot.jobsCount > 0 ? '●' : '○'}]`,
    `Last PDF    [${snapshot.lastPdfLine ? '●' : '○'}]`,
  ];

  return (
    <Box flexDirection="column">
      {!api && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow" bold>
            ! API key or provider not configured.
          </Text>
          <Text dimColor>
            Open Settings (8) or set ANTHROPIC_API_KEY / OPENROUTER_API_KEY in your environment.
          </Text>
        </Box>
      )}
      <Text bold>Suggested next</Text>
      <Text>{next}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Pipeline</Text>
        {pipeline.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      {snapshot.lastPdfLine && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Last PDF</Text>
          <Text dimColor>{snapshot.lastPdfLine}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Quick: r refine · g generate · i import · j jobs · 8 settings</Text>
      </Box>
    </Box>
  );
}
