import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import type { Sourced } from '../../profile/schema.ts';
import { loadActiveProfile } from '../../profile/serializer.ts';
import { type ContactFields, mergeContactMeta } from '../../services/contact.ts';
import { Spinner, TextInput } from '../components/shared/index.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

type FieldKey = keyof ContactFields;

const FIELD_ORDER: { key: FieldKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'headline', label: 'Headline' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'Location' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'website', label: 'Website' },
  { key: 'github', label: 'GitHub' },
];

function pickString(s: Sourced<string> | undefined): string {
  return s?.value ?? '';
}

export interface ContactScreenProps {
  profileDir: string;
}

export function ContactScreen({ profileDir }: ContactScreenProps) {
  const dispatch = useAppDispatch();
  const { focusTarget, activeScreen, inTextInput } = useAppState();
  const [phase, setPhase] = useState<'browse' | 'edit'>('browse');
  const [fieldIndex, setFieldIndex] = useState(0);
  const [values, setValues] = useState<ContactFields>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await loadActiveProfile(profileDir);
        const c = profile.contact;
        setLoadErr(null);
        setValues({
          name: pickString(c.name),
          headline: pickString(c.headline),
          email: pickString(c.email),
          phone: pickString(c.phone),
          location: pickString(c.location),
          linkedin: pickString(c.linkedin),
          website: pickString(c.website),
          github: pickString(c.github),
        });
      } catch (e) {
        setLoadErr((e as Error).message);
      }
    })();
  }, [profileDir, loadNonce]);

  const saveAll = useCallback(async () => {
    setSaveErr(null);
    setSaving(true);
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      await mergeContactMeta(values, profileDir);
      setSavedAt(new Date().toLocaleString());
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, profileDir, values]);

  const active = activeScreen === 'contact' && focusTarget === 'content';

  useInput(
    (input) => {
      if (!active || loadErr == null) {
        return;
      }
      if (input === 'r' || input === 'R') {
        setLoadErr(null);
        setLoadNonce((n) => n + 1);
      }
    },
    { isActive: active && loadErr != null },
  );

  useInput(
    (input, key) => {
      if (!active || saving || loadErr != null) {
        return;
      }
      if (phase === 'edit' && key.escape) {
        setPhase('browse');
        return;
      }
      if (phase !== 'browse' || inTextInput) {
        return;
      }
      if (key.tab) {
        setFieldIndex((i) => (i + 1) % FIELD_ORDER.length);
        return;
      }
      if (input === 's' || input === 'S') {
        void saveAll();
        return;
      }
      if (key.upArrow) {
        setFieldIndex((i) => (i - 1 + FIELD_ORDER.length) % FIELD_ORDER.length);
      }
      if (key.downArrow) {
        setFieldIndex((i) => (i + 1) % FIELD_ORDER.length);
      }
      if (key.return || input === '\r' || input === '\n') {
        setPhase('edit');
      }
    },
    { isActive: active },
  );

  const setField = (key: FieldKey, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  if (loadErr) {
    return (
      <Box flexDirection="column">
        <Text bold>Contact</Text>
        <Text color="red">{loadErr}</Text>
        <Text dimColor>Press r to retry after fixing files · Tab → sidebar</Text>
      </Box>
    );
  }

  if (saving) {
    return (
      <Box flexDirection="column">
        <Text bold>Contact</Text>
        <Spinner label="Saving…" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Contact</Text>
      <Text dimColor>
        ↑↓ Tab field · Enter edit · Esc leave field · s save all · writes profile + contact.json
      </Text>
      {savedAt != null && <Text color="green">Last saved: {savedAt}</Text>}
      {saveErr != null && (
        <Box flexDirection="column">
          <Text color="red">{saveErr}</Text>
          <Text dimColor>Fix the issue and press s to save again.</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {FIELD_ORDER.map(({ key, label }, i) => {
          const sel = i === fieldIndex;
          const v = values[key] ?? '';
          return (
            <Box key={key} flexDirection="row">
              <Box width={12}>
                <Text dimColor={!sel} bold={sel}>
                  {sel ? '› ' : '  '}
                  {label}
                </Text>
              </Box>
              {phase === 'edit' && sel ? (
                <TextInput
                  value={v}
                  onChange={(next) => {
                    setField(key, next);
                  }}
                  focus={active && phase === 'edit'}
                  onSubmit={() => {
                    setPhase('browse');
                    setFieldIndex((j) => (j + 1) % FIELD_ORDER.length);
                  }}
                />
              ) : (
                <Text dimColor={!sel}>{v || '—'}</Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
