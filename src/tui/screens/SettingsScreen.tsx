import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SelectList, TextInput } from '../components/shared/index.ts';
import { hasApiKey } from '../env.ts';
import { maskApiKeyForDisplay } from '../settings/maskApiKey.ts';
import type { ProviderId } from '../settings/probeProvider.ts';
import { probeApiKey } from '../settings/probeProvider.ts';
import { upsertEnvFileContents } from '../settings/upsertEnvFile.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

const PROVIDER_ITEMS: Array<{ value: ProviderId; label: string }> = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openrouter', label: 'OpenRouter' },
];

export interface SettingsScreenProps {
  profileDir: string;
}

export function SettingsScreen({ profileDir }: SettingsScreenProps) {
  const dispatch = useAppDispatch();
  const { activeScreen, focusTarget, inTextInput } = useAppState();
  const shortcutsActive = activeScreen === 'settings' && focusTarget === 'content' && !inTextInput;

  const [provider, setProvider] = useState<ProviderId>(() =>
    process.env.OPENROUTER_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()
      ? 'openrouter'
      : 'anthropic',
  );
  const provIndex = PROVIDER_ITEMS.findIndex((p) => p.value === provider);
  const safeProvIndex = provIndex >= 0 ? provIndex : 0;

  const [keyDraft, setKeyDraft] = useState(() =>
    provider === 'anthropic'
      ? (process.env.ANTHROPIC_API_KEY ?? '')
      : (process.env.OPENROUTER_API_KEY ?? ''),
  );

  const [fieldFocus, setFieldFocus] = useState<'provider' | 'key'>('provider');
  const [statusLine, setStatusLine] = useState('');
  const [envNote, setEnvNote] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const path = join(process.cwd(), '.env');
      try {
        await readFile(path, 'utf-8');
        setEnvNote(`Found .env at ${path}`);
      } catch {
        setEnvNote(`No .env in cwd (${process.cwd()}). Keys may come from the environment only.`);
      }
    })();
  }, []);

  const applyProvider = useCallback((p: ProviderId) => {
    setProvider(p);
    setKeyDraft(
      p === 'anthropic'
        ? (process.env.ANTHROPIC_API_KEY ?? '')
        : (process.env.OPENROUTER_API_KEY ?? ''),
    );
  }, []);

  const save = useCallback(async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) {
      setStatusLine('Enter an API key first (e → key field).');
      return;
    }
    setStatusLine('Probing API…');
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      const probed = await probeApiKey(provider, trimmed);
      if (!probed.ok) {
        setStatusLine(`Probe failed: ${probed.message}`);
        return;
      }
      const envPath = join(process.cwd(), '.env');
      let before = '';
      try {
        before = await readFile(envPath, 'utf-8');
      } catch {
        before = '';
      }
      const envKey = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
      const merged = upsertEnvFileContents(before, { [envKey]: trimmed });
      await mkdir(dirname(envPath), { recursive: true });
      await writeFile(envPath, merged, 'utf-8');
      setStatusLine(`Saved ${envKey} to ${envPath}. Restart suited to load it.`);
    } catch (e) {
      setStatusLine(e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, keyDraft, provider]);

  useInput(
    (_input, key) => {
      if (!shortcutsActive) return;
      if (key.ctrl || key.meta) return;

      const input = _input;
      if (input === 'a' || input === 'A') {
        applyProvider('anthropic');
        setFieldFocus('provider');
        return;
      }
      if (input === 'o' || input === 'O') {
        applyProvider('openrouter');
        setFieldFocus('provider');
        return;
      }
      if (input === 'e') {
        setFieldFocus('key');
        return;
      }
      if (input === 'l') {
        setFieldFocus('provider');
        return;
      }
      if (input === 's') {
        void save();
      }
    },
    { isActive: shortcutsActive },
  );

  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENROUTER_API_KEY;
  const configured = hasApiKey();

  const listActive = useMemo(
    () => shortcutsActive && fieldFocus === 'provider',
    [shortcutsActive, fieldFocus],
  );
  const keyActive = useMemo(
    () => shortcutsActive && fieldFocus === 'key',
    [shortcutsActive, fieldFocus],
  );

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <Text dimColor>Profile directory: {profileDir}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>API (from environment)</Text>
        <Text dimColor>ANTHROPIC_API_KEY: {ak ? maskApiKeyForDisplay(ak) : '(not set)'}</Text>
        <Text dimColor>OPENROUTER_API_KEY: {ok ? maskApiKeyForDisplay(ok) : '(not set)'}</Text>
        <Text {...(configured ? { color: 'green' } : { color: 'yellow' })}>
          {configured ? 'Provider configured ✓' : 'No API key — add to .env or export in shell'}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Provider (l)</Text>
        <SelectList
          items={PROVIDER_ITEMS}
          selectedIndex={safeProvIndex}
          onChange={(_, item) => {
            applyProvider(item.value);
          }}
          isActive={listActive}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>API key (e)</Text>
        <Text dimColor>Masked in field · paste your key · s save (probe + write .env)</Text>
        <TextInput
          value={keyDraft}
          onChange={setKeyDraft}
          focus={keyActive}
          mask="*"
          placeholder="sk-…"
        />
      </Box>
      {statusLine ? (
        <Box marginTop={1}>
          <Text color="cyan">{statusLine}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          a/A Anthropic · o/O OpenRouter · e key · l provider · s save · restart suited after save
        </Text>
        <Text dimColor>{envNote}</Text>
      </Box>
    </Box>
  );
}
