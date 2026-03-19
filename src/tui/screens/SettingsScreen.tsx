import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { hasApiKey } from '../env.js';

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 7)}…${'•'.repeat(12)}`;
}

export interface SettingsScreenProps {
  profileDir: string;
}

export function SettingsScreen({ profileDir }: SettingsScreenProps) {
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

  const ak = process.env.ANTHROPIC_API_KEY;
  const ok = process.env.OPENROUTER_API_KEY;
  const configured = hasApiKey();

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <Text dimColor>Profile directory: {profileDir}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>API (from environment)</Text>
        <Text dimColor>ANTHROPIC_API_KEY: {ak ? maskKey(ak) : '(not set)'}</Text>
        <Text dimColor>OPENROUTER_API_KEY: {ok ? maskKey(ok) : '(not set)'}</Text>
        <Text {...(configured ? { color: 'green' } : { color: 'yellow' })}>
          {configured ? 'Provider configured ✓' : 'No API key — add to .env or export in shell'}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{envNote}</Text>
      </Box>
    </Box>
  );
}
