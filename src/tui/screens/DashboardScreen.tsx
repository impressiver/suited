import { Box, Text } from 'ink';
import { useCallback, useMemo, useState } from 'react';
import { SelectList } from '../components/shared/SelectList.tsx';
import { hasApiKey } from '../env.ts';
import type { ProfileSnapshot } from '../hooks/useProfileSnapshot.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppState } from '../store.tsx';
import { SCREEN_ORDER, type ScreenId } from '../types.ts';

export interface DashboardScreenProps {
  snapshot: ProfileSnapshot;
  profileDir: string;
  onRefreshSnapshot?: () => void;
  /** Kept for App.tsx compat; not used by hub. */
  onSectionChange?: (section: string | null) => void;
}

interface QuickAction {
  value: ScreenId;
  label: string;
  shortcut: string;
}

export function DashboardScreen({
  snapshot,
}: DashboardScreenProps) {
  const navigate = useNavigateToScreen();
  const { activeScreen } = useAppState();
  const panelActive = activeScreen === 'dashboard';
  const api = hasApiKey();
  const [actionIdx, setActionIdx] = useState(0);

  useRegisterPanelFooterHint(
    'Dashboard · ↑↓ Enter · e edit · j jobs · i import · c contact · g generate · s settings · : palette · ? help',
  );

  const actions = useMemo((): QuickAction[] => {
    const items: QuickAction[] = [];
    if (!snapshot.hasSource) {
      items.push({ value: 'import', label: 'Import a resume to get started', shortcut: 'i' });
      items.push({ value: 'settings', label: 'Settings', shortcut: 's' });
      return items;
    }
    items.push({ value: 'editor', label: 'Edit resume', shortcut: 'e' });
    items.push({ value: 'jobs', label: 'Add / manage jobs', shortcut: 'j' });
    items.push({ value: 'import', label: 'Import new source', shortcut: 'i' });
    items.push({ value: 'contact', label: 'Update contact info', shortcut: 'c' });
    items.push({ value: 'generate', label: 'Generate PDF', shortcut: 'g' });
    items.push({ value: 'settings', label: 'Settings', shortcut: 's' });
    return items;
  }, [snapshot.hasSource]);

  const handleActionSubmit = useCallback(
    (item: { value: ScreenId }) => navigate(item.value),
    [navigate],
  );

  const actionItems = useMemo(
    () => actions.map((a) => ({ value: a.value, label: `${a.label}  ${a.shortcut}` })),
    [actions],
  );

  const dot = (filled: boolean) => (filled ? '●' : '○');
  const dotColor = (filled: boolean): string => (filled ? 'green' : 'gray');

  const sourceStatus = snapshot.hasSource ? 'Imported' : 'Not imported';
  const refinedStatus = snapshot.hasRefined ? 'Refined' : 'Not refined';
  const jobsStatus = snapshot.jobsCount > 0 ? `${snapshot.jobsCount} saved` : 'No jobs';
  const pdfStatus = snapshot.lastPdfLine ?? 'No PDFs generated yet';

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {!api && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow" bold>
            ! API key or provider not configured.
          </Text>
          <Text dimColor>
            Open Settings ({SCREEN_ORDER.indexOf('settings') + 1}) or set ANTHROPIC_API_KEY /
            OPENROUTER_API_KEY in your environment.
          </Text>
        </Box>
      )}

      {/* Profile identity */}
      {snapshot.hasSource && snapshot.name && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>{snapshot.name}</Text>
          {snapshot.headline && <Text>{snapshot.headline}</Text>}
          <Text dimColor>
            {snapshot.positionCount} positions · {snapshot.skillCount} skills
          </Text>
        </Box>
      )}

      {/* Pipeline */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold dimColor>
          ── Pipeline ──
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text>
            <Text color={dotColor(snapshot.hasSource)}>{dot(snapshot.hasSource)}</Text>
            {' Source       '}
            <Text dimColor>{sourceStatus}</Text>
          </Text>
          <Text>
            <Text color={dotColor(snapshot.hasRefined)}>{dot(snapshot.hasRefined)}</Text>
            {' Refined      '}
            <Text dimColor>{refinedStatus}</Text>
          </Text>
          <Text>
            <Text color={dotColor(snapshot.contactFieldCount > 0)}>{dot(snapshot.contactFieldCount > 0)}</Text>
            {' Contact      '}
            <Text dimColor>{snapshot.contactFieldCount > 0 ? `${snapshot.contactFieldCount} fields` : 'Not set'}</Text>
          </Text>
          <Text>
            <Text color={dotColor(snapshot.jobsCount > 0)}>{dot(snapshot.jobsCount > 0)}</Text>
            {' Jobs         '}
            <Text dimColor>{jobsStatus}</Text>
          </Text>
          <Text>
            <Text color={dotColor(Boolean(snapshot.lastPdfLine))}>
              {dot(Boolean(snapshot.lastPdfLine))}
            </Text>
            {' PDF          '}
            <Text dimColor>{pdfStatus}</Text>
          </Text>
        </Box>
      </Box>

      {/* Quick Actions */}
      <Box flexDirection="column">
        <Text bold dimColor>
          ── Quick Actions ──
        </Text>
        <Box marginLeft={2} marginTop={1}>
          <SelectList
            items={actionItems}
            selectedIndex={actionIdx}
            onChange={setActionIdx}
            isActive={panelActive}
            onSubmit={handleActionSubmit}
          />
        </Box>
      </Box>
    </Box>
  );
}
