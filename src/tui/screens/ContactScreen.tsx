import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Sourced } from '../../profile/schema.ts';
import { loadActiveProfile } from '../../profile/serializer.ts';
import {
  type ContactFields,
  mergeContactMeta,
  validateContactFields,
} from '../../services/contact.ts';
import { Spinner, TextInput } from '../components/shared/index.ts';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { getEffectiveScreen, useAppDispatch, useAppState } from '../store.tsx';

type FieldKey = keyof ContactFields;

const FIELD_ORDER: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', required: true },
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
  const appState = useAppState();
  const { focusTarget, inTextInput, persistenceTarget } = appState;
  const effectiveScreen = getEffectiveScreen(appState);
  const [phase, setPhase] = useState<'browse' | 'edit'>('browse');
  const [fieldIndex, setFieldIndex] = useState(0);
  const [values, setValues] = useState<ContactFields>({ name: '' });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    void loadNonce;
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
        setValidationErrors({});
      } catch (e) {
        setLoadErr((e as Error).message);
      }
    })();
  }, [profileDir, loadNonce]);

  const validateField = useCallback(
    (key: FieldKey, value: string): string | null => {
      const result = validateContactFields({ ...values, [key]: value });
      if (!result.success) {
        return result.errors[key] ?? null;
      }
      return null;
    },
    [values],
  );

  const setField = useCallback((key: FieldKey, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    // Clear validation error when user starts typing
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const saveAll = useCallback(async () => {
    setSaveErr(null);
    setValidationErrors({});

    // Validate before saving
    const validation = validateContactFields(values);
    if (!validation.success) {
      setValidationErrors(validation.errors);
      setSaveErr('Please fix validation errors before saving.');
      return;
    }

    setSaving(true);
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      await mergeContactMeta(validation.data, profileDir, { persistenceTarget });
      setSavedAt(new Date().toLocaleString());
      // Reload to ensure we show the saved state (with any transformations applied)
      setLoadNonce((n) => n + 1);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, persistenceTarget, profileDir, values]);

  const active = effectiveScreen === 'contact' && focusTarget === 'content';

  const contactFooterHint = useMemo(() => {
    const sb = ' · : palette';
    if (loadErr != null) {
      return `Contact · r retry after fixing files${sb}`;
    }
    if (saving) {
      return `Contact · saving…${sb}`;
    }
    const errNote = saveErr != null ? ' · fix issue then s save' : '';
    if (phase === 'browse') {
      return `Contact · ↑↓ Tab field · Enter edit · s save all${errNote}${sb}`;
    }
    return `Contact · Esc leave field · Enter next field${errNote}${sb}`;
  }, [loadErr, phase, saveErr, saving]);

  useRegisterPanelFooterHint(contactFooterHint);

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
        // Validate on exit
        const currentKey = FIELD_ORDER[fieldIndex].key;
        const error = validateField(currentKey, values[currentKey] ?? '');
        if (error) {
          setValidationErrors((prev) => ({ ...prev, [currentKey]: error }));
        }
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

  if (loadErr) {
    return (
      <Box flexDirection="column">
        <Text bold>Contact</Text>
        <Text color="red">{loadErr}</Text>
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
      {savedAt != null && <Text color="green">Last saved: {savedAt}</Text>}
      {saveErr != null && <Text color="red">{saveErr}</Text>}
      <Box marginTop={1} flexDirection="column">
        {FIELD_ORDER.map(({ key, label, required }, i) => {
          const sel = i === fieldIndex;
          const v = values[key] ?? '';
          const showMenuCaret = active && phase === 'browse' && sel;
          const error = validationErrors[key];
          return (
            <Box key={key} flexDirection="row">
              <Box width={12}>
                <Text bold={showMenuCaret} color={error ? 'red' : 'white'}>
                  {showMenuCaret ? '› ' : '  '}
                  {label}
                  {required && <Text color="yellow">*</Text>}
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
                    const error = validateField(key, values[key] ?? '');
                    if (error) {
                      setValidationErrors((prev) => ({ ...prev, [key]: error }));
                    }
                    setPhase('browse');
                    setFieldIndex((j) => (j + 1) % FIELD_ORDER.length);
                  }}
                />
              ) : (
                <Text dimColor={!v} color={error ? 'red' : undefined}>
                  {v || '—'}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
