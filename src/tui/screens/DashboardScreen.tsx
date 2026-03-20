import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { loadActiveProfile } from '../../profile/serializer.ts';
import type { HealthScore } from '../../services/improve.ts';
import { computeHealthScore } from '../../services/improve.ts';
import {
  ScrollView,
  type SelectItem,
  SelectList,
  StatusBadge,
} from '../components/shared/index.ts';
import { getDashboardVariant } from '../dashboardVariant.ts';
import { hasApiKey } from '../env.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useAppDispatch } from '../store.tsx';
import { suggestedNextLine } from '../suggestedNext.ts';
import type { ScreenId } from '../types.ts';

const QUICK_ACTIONS: Array<SelectItem<ScreenId>> = [
  { value: 'import', label: '2 · Import source' },
  { value: 'refine', label: '3 · Refine profile' },
  { value: 'generate', label: '4 · Generate resume' },
  { value: 'jobs', label: '5 · Jobs' },
  { value: 'settings', label: '8 · Settings' },
];

export interface DashboardScreenProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
}

export function DashboardScreen({ snapshot, profileDir }: DashboardScreenProps) {
  const dispatch = useAppDispatch();
  const api = hasApiKey();
  const variant = getDashboardVariant(snapshot, api);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot.loading || snapshot.error || !snapshot.hasRefined) {
      setHealth(null);
      setHealthErr(null);
      return;
    }
    let cancelled = false;
    void loadActiveProfile(profileDir)
      .then((p) => {
        if (!cancelled) {
          setHealth(computeHealthScore(p, snapshot.hasRefined));
          setHealthErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setHealth(null);
          setHealthErr(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileDir, snapshot.loading, snapshot.error, snapshot.hasRefined]);

  const next = suggestedNextLine({
    hasApiKey: api,
    hasSource: snapshot.hasSource,
    hasRefined: snapshot.hasRefined,
  });

  const [quickIndex, setQuickIndex] = useState(0);

  const variantTone = useMemo(() => {
    switch (variant) {
      case 'ready':
        return 'ok' as const;
      case 'no-api-key':
      case 'no-source':
        return 'warn' as const;
      default:
        return 'info' as const;
    }
  }, [variant]);

  const pipelineLines = useMemo(
    () => [
      `Source      [${snapshot.hasSource ? '●' : '○'}]`,
      `Refined     [${snapshot.hasRefined ? '●' : '○'}]`,
      `Jobs        [${snapshot.jobsCount > 0 ? '●' : '○'}]`,
      `Last PDF    [${snapshot.lastPdfLine ? '●' : '○'}]`,
    ],
    [snapshot.hasSource, snapshot.hasRefined, snapshot.jobsCount, snapshot.lastPdfLine],
  );

  const activityLines = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Jobs saved: ${snapshot.jobsCount}`);
    if (snapshot.lastPdfLine) {
      lines.push(`Last PDF: ${snapshot.lastPdfLine}`);
    }
    return lines;
  }, [snapshot.jobsCount, snapshot.lastPdfLine]);

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
      <Box marginBottom={1} flexDirection="column">
        <Text bold>Status</Text>
        <StatusBadge tone={variantTone}>{variant.replace(/-/g, ' ')}</StatusBadge>
      </Box>
      {health && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>Health</Text>
          <Text>
            Score {health.score}/5 · skills {health.skillCount}
            {health.noBulletCompanyNames.length > 0
              ? ` · bullets missing: ${health.noBulletCompanyNames.slice(0, 3).join(', ')}${
                  health.noBulletCompanyNames.length > 3 ? '…' : ''
                }`
              : ''}
          </Text>
        </Box>
      )}
      {healthErr && (
        <Box marginBottom={1}>
          <Text color="yellow">Could not load health: {healthErr}</Text>
        </Box>
      )}
      <Text bold>Suggested next</Text>
      <Text>{next}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Pipeline</Text>
        <ScrollView lines={pipelineLines} height={4} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Activity</Text>
        <ScrollView lines={activityLines} height={3} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Quick actions (↑↓ Enter)</Text>
        <SelectList
          items={QUICK_ACTIONS}
          selectedIndex={quickIndex}
          onChange={(i) => setQuickIndex(i)}
          onSubmit={(item) => dispatch({ type: 'SET_SCREEN', screen: item.value })}
          isActive
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Nav: r refine · g generate · i import · j jobs · 8 settings · Tab sidebar
        </Text>
      </Box>
    </Box>
  );
}
