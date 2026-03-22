import { randomUUID } from 'node:crypto';
import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { profileToMarkdown } from '../../profile/markdown.ts';
import type {
  Certification,
  Education,
  Position,
  Profile,
  Project,
  RefinementSession,
  Sourced,
} from '../../profile/schema.ts';
import {
  loadRefined,
  loadSource,
  refinedJsonPath,
  saveRefined,
  saveSource,
  sourceJsonPath,
  sourceMdPath,
} from '../../profile/serializer.ts';
import { fileExists } from '../../utils/fs.ts';
import { ConfirmPrompt, InlineEditor, SelectList, Spinner } from '../components/shared/index.ts';
import { useRegisterBlockingUi } from '../hooks/useRegisterBlockingUi.ts';
import { useNavigateToScreen } from '../navigationContext.tsx';
import { useRegisterPanelFooterHint } from '../panelFooterHintContext.tsx';
import { useAppDispatch, useAppState } from '../store.tsx';

function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

function userEdit(value: string): Sourced<string> {
  const now = new Date().toISOString();
  return { value, source: { kind: 'user-edit', editedAt: now } };
}

function swapByIndex<T>(items: T[], a: number, b: number): void {
  const x = items[a];
  const y = items[b];
  if (x === undefined || y === undefined) return;
  items[a] = y;
  items[b] = x;
}

async function persistProfile(
  profile: Profile,
  profileDir: string,
  session: RefinementSession | null,
): Promise<void> {
  if (session) {
    await saveRefined({ profile, session }, profileDir, { reason: 'profile-editor' });
  } else {
    await saveSource(profile, profileDir);
    await profileToMarkdown(profile, sourceMdPath(profileDir));
  }
}

type Frame =
  | { k: 'sections' }
  | { k: 'summary' }
  | { k: 'positions' }
  | { k: 'bullets'; posIdx: number }
  | { k: 'bullet-edit'; posIdx: number; bulletIdx: number }
  | { k: 'skills' }
  | { k: 'skill-edit'; skillIdx: number }
  | { k: 'education' }
  | { k: 'education-edit'; eduIdx: number }
  | { k: 'certifications' }
  | { k: 'cert-edit'; certIdx: number }
  | { k: 'projects' }
  | { k: 'project-edit'; projIdx: number };

type UnsavedAction = { action: 'pop' | 'sidebar' };

export interface ProfileEditorScreenProps {
  profileDir: string;
}

export function ProfileEditorScreen({ profileDir }: ProfileEditorScreenProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigateToScreen();
  const { activeScreen, focusTarget, inTextInput, profileEditorReturnTo } = useAppState();
  const active = activeScreen === 'profile' && focusTarget === 'content';

  const [phase, setPhase] = useState<'loading' | 'no-source' | 'ready' | 'saving' | 'err'>(
    'loading',
  );
  const [loadNonce, setLoadNonce] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<RefinementSession | null>(null);
  const baselineRef = useRef<Profile | null>(null);

  useRegisterBlockingUi(active && phase === 'err' && profile != null);
  const [dirty, setDirty] = useState(false);
  const [stack, setStack] = useState<Frame[]>([{ k: 'sections' }]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [unsaved, setUnsaved] = useState<UnsavedAction | null>(null);
  const [bulletDeletePrompt, setBulletDeletePrompt] = useState<{
    posIdx: number;
    bulletIdx: number;
  } | null>(null);
  const [skillDeletePrompt, setSkillDeletePrompt] = useState<{ skillIdx: number } | null>(null);
  const [eduDeletePrompt, setEduDeletePrompt] = useState<{ eduIdx: number } | null>(null);
  const [certDeletePrompt, setCertDeletePrompt] = useState<{ certIdx: number } | null>(null);
  const [projDeletePrompt, setProjDeletePrompt] = useState<{ projIdx: number } | null>(null);
  const [positionDeletePrompt, setPositionDeletePrompt] = useState<{ posIdx: number } | null>(null);
  const [saveFailStreak, setSaveFailStreak] = useState(0);
  const [saveErrMenuIdx, setSaveErrMenuIdx] = useState(0);
  const top = stack.at(-1);

  const profileFooterHint = useMemo(() => {
    const sb = ' · Tab sidebar';
    if (phase === 'loading') {
      return `Refine · edit sections · loading…${sb}`;
    }
    if (phase === 'no-source') {
      return `Refine · edit sections · import a profile first${sb}`;
    }
    if (phase === 'err' && !profile) {
      return `Refine · edit sections · r retry${sb}`;
    }
    if (phase === 'err' && profile) {
      return `Refine · edit sections · ↑↓ Enter · retry / settings / dismiss${sb}`;
    }
    if (phase === 'saving') {
      return `Refine · edit sections · saving…${sb}`;
    }
    if (!profile) {
      return `Refine · edit sections${sb}`;
    }
    if (unsaved) {
      return `Refine · edit sections · s save and continue · d/n discard · Esc stay`;
    }
    if (
      bulletDeletePrompt ||
      skillDeletePrompt ||
      eduDeletePrompt ||
      certDeletePrompt ||
      projDeletePrompt ||
      positionDeletePrompt
    ) {
      return `Refine · edit sections · Enter confirm · Esc cancel${sb}`;
    }
    if (!top) {
      return `Refine · edit sections${sb}`;
    }
    if (top.k === 'sections') {
      return `Refine · edit sections · ↑↓ Enter section · Esc back · s save${sb}`;
    }
    if (top.k === 'summary') {
      return editingSummary
        ? `Refine · edit sections · Enter save · Esc cancel edit${sb}`
        : `Refine · edit sections · Enter edit summary · Esc back · s save${sb}`;
    }
    if (top.k === 'positions') {
      return `Refine · edit sections · ↑↓ · [ ] reorder · a add · d delete · Enter → bullets${sb}`;
    }
    if (top.k === 'skills') {
      return `Refine · edit sections · ↑↓ · [ ] move · a add · d delete · Enter edit name${sb}`;
    }
    if (top.k === 'skill-edit') {
      return `Refine · edit sections · Enter save · Esc back${sb}`;
    }
    if (top.k === 'education') {
      return `Refine · edit sections · ↑↓ · [ ] reorder · a add · d delete · Enter edit institution${sb}`;
    }
    if (top.k === 'education-edit') {
      return `Refine · edit sections · Enter save · Esc back · institution only${sb}`;
    }
    if (top.k === 'certifications') {
      return `Refine · edit sections · ↑↓ · [ ] reorder · a add · d delete · Enter edit name${sb}`;
    }
    if (top.k === 'cert-edit') {
      return `Refine · edit sections · Enter save · Esc back${sb}`;
    }
    if (top.k === 'projects') {
      return `Refine · edit sections · ↑↓ · [ ] reorder · a add · d delete · Enter edit title${sb}`;
    }
    if (top.k === 'project-edit') {
      return `Refine · edit sections · Enter save · Esc back${sb}`;
    }
    if (top.k === 'bullets') {
      return `Refine · edit sections · ↑↓ · [ ] move · a add · d delete · Enter edit bullet${sb}`;
    }
    if (top.k === 'bullet-edit') {
      return `Refine · edit sections · Enter save · Esc cancel${sb}`;
    }
    return `Refine · edit sections${sb}`;
  }, [
    phase,
    profile,
    unsaved,
    top,
    bulletDeletePrompt,
    skillDeletePrompt,
    eduDeletePrompt,
    certDeletePrompt,
    projDeletePrompt,
    positionDeletePrompt,
    editingSummary,
  ]);

  useRegisterPanelFooterHint(profileFooterHint);

  useEffect(() => {
    dispatch({ type: 'SET_PROFILE_EDITOR_DIRTY', value: dirty });
  }, [dirty, dispatch]);

  useEffect(() => {
    void loadNonce;
    void (async () => {
      setPhase('loading');
      setErrMsg(null);
      try {
        if (!(await fileExists(sourceJsonPath(profileDir)))) {
          setPhase('no-source');
          return;
        }
        if (await fileExists(refinedJsonPath(profileDir))) {
          const data = await loadRefined(profileDir);
          const p = cloneProfile(data.profile);
          baselineRef.current = cloneProfile(p);
          setProfile(p);
          setSession(data.session);
        } else {
          const p = cloneProfile(await loadSource(profileDir));
          baselineRef.current = cloneProfile(p);
          setProfile(p);
          setSession(null);
        }
        setPhase('ready');
        setSaveFailStreak(0);
      } catch (e) {
        setErrMsg((e as Error).message);
        setPhase('err');
      }
    })();
  }, [profileDir, loadNonce]);

  useEffect(
    () => () => {
      dispatch({ type: 'SET_PROFILE_EDITOR_DIRTY', value: false });
    },
    [dispatch],
  );

  useInput(
    (input) => {
      if (!active || phase !== 'err' || inTextInput) {
        return;
      }
      if (input === 'r' || input === 'R') {
        setErrMsg(null);
        setLoadNonce((n) => n + 1);
      }
    },
    { isActive: active && phase === 'err' && !inTextInput },
  );

  const save = useCallback(async () => {
    if (!profile) {
      return;
    }
    setPhase('saving');
    dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: true });
    try {
      await persistProfile(profile, profileDir, session);
      baselineRef.current = cloneProfile(profile);
      setDirty(false);
      if (session) {
        dispatch({ type: 'SET_HAS_REFINED', hasRefined: true });
      }
      setPhase('ready');
      setSaveFailStreak(0);
    } catch (e) {
      setSaveFailStreak((n) => n + 1);
      setSaveErrMenuIdx(0);
      setErrMsg((e as Error).message);
      setPhase('err');
    } finally {
      dispatch({ type: 'SET_OPERATION_IN_PROGRESS', value: false });
    }
  }, [dispatch, profile, profileDir, session]);

  const discardChanges = useCallback(() => {
    if (baselineRef.current) {
      setProfile(cloneProfile(baselineRef.current));
    }
    setDirty(false);
    setEditingSummary(false);
    setSummaryDraft('');
  }, []);

  const popStack = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    setMenuIdx(0);
  }, []);

  const runAfterResolved = useCallback(
    (action: UnsavedAction['action']) => {
      setUnsaved(null);
      if (action === 'pop') {
        popStack();
      } else {
        dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
      }
    },
    [dispatch, popStack],
  );

  const handleEsc = useCallback(() => {
    if (dirty) {
      setUnsaved({ action: stack.length === 1 ? 'sidebar' : 'pop' });
      return;
    }
    if (stack.length > 1) {
      popStack();
      return;
    }
    if (profileEditorReturnTo) {
      navigate(profileEditorReturnTo);
      return;
    }
    dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
  }, [dirty, dispatch, navigate, popStack, profileEditorReturnTo, stack.length]);

  useInput(
    (input, key) => {
      if (!active || phase !== 'ready' || unsaved || !profile) {
        return;
      }
      if (
        bulletDeletePrompt ||
        skillDeletePrompt ||
        eduDeletePrompt ||
        certDeletePrompt ||
        projDeletePrompt ||
        positionDeletePrompt
      ) {
        return;
      }
      if (editingSummary && key.escape) {
        setEditingSummary(false);
        setSummaryDraft(profile?.summary?.value ?? '');
        return;
      }
      if (top?.k === 'bullet-edit' && key.escape) {
        popStack();
        return;
      }
      if (top?.k === 'skill-edit' && key.escape) {
        popStack();
        return;
      }
      if (top?.k === 'education-edit' && key.escape) {
        popStack();
        return;
      }
      if (top?.k === 'cert-edit' && key.escape) {
        popStack();
        return;
      }
      if (top?.k === 'project-edit' && key.escape) {
        popStack();
        return;
      }
      const isEnter = Boolean(key.return) || input === '\n' || input === '\r';
      if (top?.k === 'summary' && !editingSummary && isEnter) {
        setSummaryDraft(profile.summary?.value ?? '');
        setEditingSummary(true);
        return;
      }
      if (inTextInput) {
        return;
      }
      if (top?.k === 'positions') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const month = new Date().toISOString().slice(0, 7);
            const row: Position = {
              id: `pos-${randomUUID()}`,
              title: userEdit('New role'),
              company: userEdit('Company'),
              startDate: userEdit(month),
              bullets: [],
            };
            next.positions = [...next.positions, row];
            newIdx = next.positions.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const positions = profile.positions;
          if (positions.length > 0) {
            const pi = Math.min(menuIdx, positions.length - 1);
            setPositionDeletePrompt({ posIdx: pi });
          }
          return;
        }
        if (input === '[') {
          const positions = profile.positions;
          if (positions.length < 2) {
            return;
          }
          const pi = Math.min(menuIdx, positions.length - 1);
          if (pi <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.positions, pi - 1, pi);
            return next;
          });
          setDirty(true);
          setMenuIdx(pi - 1);
          return;
        }
        if (input === ']') {
          const positions = profile.positions;
          if (positions.length < 2) {
            return;
          }
          const pi = Math.min(menuIdx, positions.length - 1);
          if (pi >= positions.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.positions, pi, pi + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(pi + 1);
          return;
        }
      }
      if (top?.k === 'bullets') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const np = next.positions[top.posIdx];
            if (!np) {
              return p;
            }
            np.bullets.push(userEdit(''));
            newIdx = np.bullets.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const pos = profile.positions[top.posIdx];
          if (pos && pos.bullets.length > 0) {
            const bi = Math.min(menuIdx, pos.bullets.length - 1);
            setBulletDeletePrompt({ posIdx: top.posIdx, bulletIdx: bi });
          }
          return;
        }
        if (input === '[') {
          const pos = profile.positions[top.posIdx];
          if (!pos || pos.bullets.length < 2) {
            return;
          }
          const bi = Math.min(menuIdx, pos.bullets.length - 1);
          if (bi <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const np = next.positions[top.posIdx];
            if (!np?.bullets[bi - 1] || !np.bullets[bi]) {
              return p;
            }
            swapByIndex(np.bullets, bi - 1, bi);
            return next;
          });
          setDirty(true);
          setMenuIdx(bi - 1);
          return;
        }
        if (input === ']') {
          const pos = profile.positions[top.posIdx];
          if (!pos || pos.bullets.length < 2) {
            return;
          }
          const bi = Math.min(menuIdx, pos.bullets.length - 1);
          if (bi >= pos.bullets.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const np = next.positions[top.posIdx];
            if (!np?.bullets[bi] || !np.bullets[bi + 1]) {
              return p;
            }
            swapByIndex(np.bullets, bi, bi + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(bi + 1);
          return;
        }
      }
      if (top?.k === 'skills') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            next.skills = [...next.skills, { id: `skill-${randomUUID()}`, name: userEdit('') }];
            newIdx = next.skills.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const skills = profile.skills;
          if (skills.length > 0) {
            const si = Math.min(menuIdx, skills.length - 1);
            setSkillDeletePrompt({ skillIdx: si });
          }
          return;
        }
        if (input === '[') {
          const skills = profile.skills;
          if (skills.length < 2) {
            return;
          }
          const si = Math.min(menuIdx, skills.length - 1);
          if (si <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.skills, si - 1, si);
            return next;
          });
          setDirty(true);
          setMenuIdx(si - 1);
          return;
        }
        if (input === ']') {
          const skills = profile.skills;
          if (skills.length < 2) {
            return;
          }
          const si = Math.min(menuIdx, skills.length - 1);
          if (si >= skills.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.skills, si, si + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(si + 1);
          return;
        }
      }
      if (top?.k === 'education') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const row: Education = {
              id: `edu-${randomUUID()}`,
              institution: userEdit(''),
            };
            next.education = [...next.education, row];
            newIdx = next.education.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const rows = profile.education;
          if (rows.length > 0) {
            const ei = Math.min(menuIdx, rows.length - 1);
            setEduDeletePrompt({ eduIdx: ei });
          }
          return;
        }
        if (input === '[') {
          const rows = profile.education;
          if (rows.length < 2) {
            return;
          }
          const ei = Math.min(menuIdx, rows.length - 1);
          if (ei <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.education, ei - 1, ei);
            return next;
          });
          setDirty(true);
          setMenuIdx(ei - 1);
          return;
        }
        if (input === ']') {
          const rows = profile.education;
          if (rows.length < 2) {
            return;
          }
          const ei = Math.min(menuIdx, rows.length - 1);
          if (ei >= rows.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.education, ei, ei + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(ei + 1);
          return;
        }
      }
      if (top?.k === 'certifications') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const row: Certification = {
              id: `cert-${randomUUID()}`,
              name: userEdit(''),
            };
            next.certifications = [...next.certifications, row];
            newIdx = next.certifications.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const rows = profile.certifications;
          if (rows.length > 0) {
            const ci = Math.min(menuIdx, rows.length - 1);
            setCertDeletePrompt({ certIdx: ci });
          }
          return;
        }
        if (input === '[') {
          const rows = profile.certifications;
          if (rows.length < 2) {
            return;
          }
          const ci = Math.min(menuIdx, rows.length - 1);
          if (ci <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.certifications, ci - 1, ci);
            return next;
          });
          setDirty(true);
          setMenuIdx(ci - 1);
          return;
        }
        if (input === ']') {
          const rows = profile.certifications;
          if (rows.length < 2) {
            return;
          }
          const ci = Math.min(menuIdx, rows.length - 1);
          if (ci >= rows.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.certifications, ci, ci + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(ci + 1);
          return;
        }
      }
      if (top?.k === 'projects') {
        if (input === 'a' || input === 'A') {
          let newIdx = 0;
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            const row: Project = {
              id: `proj-${randomUUID()}`,
              title: userEdit(''),
            };
            next.projects = [...next.projects, row];
            newIdx = next.projects.length - 1;
            return next;
          });
          setDirty(true);
          setMenuIdx(newIdx);
          return;
        }
        if (input === 'd' || input === 'D') {
          const rows = profile.projects;
          if (rows.length > 0) {
            const pi = Math.min(menuIdx, rows.length - 1);
            setProjDeletePrompt({ projIdx: pi });
          }
          return;
        }
        if (input === '[') {
          const rows = profile.projects;
          if (rows.length < 2) {
            return;
          }
          const pi = Math.min(menuIdx, rows.length - 1);
          if (pi <= 0) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.projects, pi - 1, pi);
            return next;
          });
          setDirty(true);
          setMenuIdx(pi - 1);
          return;
        }
        if (input === ']') {
          const rows = profile.projects;
          if (rows.length < 2) {
            return;
          }
          const pi = Math.min(menuIdx, rows.length - 1);
          if (pi >= rows.length - 1) {
            return;
          }
          setProfile((p) => {
            if (!p) {
              return p;
            }
            const next = cloneProfile(p);
            swapByIndex(next.projects, pi, pi + 1);
            return next;
          });
          setDirty(true);
          setMenuIdx(pi + 1);
          return;
        }
      }
      if (input === 's' || input === 'S') {
        void save();
        return;
      }
      if (key.escape) {
        handleEsc();
      }
    },
    { isActive: active && phase === 'ready' && !unsaved },
  );

  useInput(
    (input, key) => {
      if (!active || !unsaved) {
        return;
      }
      const action = unsaved.action;
      if (input === 's' || input === 'S') {
        void (async () => {
          await save();
          runAfterResolved(action);
        })();
        return;
      }
      if (input === 'd' || input === 'D' || input === 'n' || input === 'N') {
        discardChanges();
        runAfterResolved(action);
        return;
      }
      if (key.escape) {
        setUnsaved(null);
      }
    },
    { isActive: active && unsaved != null },
  );

  if (phase === 'loading') {
    return (
      <Box flexDirection="column">
        <Text bold>Edit sections</Text>
        <Spinner label="Loading…" />
      </Box>
    );
  }

  if (phase === 'no-source') {
    return (
      <Box flexDirection="column">
        <Text bold>Edit sections</Text>
        <Text color="yellow">No source.json — import a profile first.</Text>
      </Box>
    );
  }

  if (phase === 'err' && !profile) {
    return (
      <Box flexDirection="column">
        <Text bold>Edit sections</Text>
        <Text color="red">{errMsg ?? 'Unknown error'}</Text>
      </Box>
    );
  }

  if (phase === 'err' && profile) {
    const showSettings = saveFailStreak >= 3;
    const saveErrItems = [
      { value: 'retry' as const, label: 'Retry save' },
      ...(showSettings
        ? [{ value: 'settings' as const, label: 'Check Settings (API key / disk)' }]
        : []),
      { value: 'dismiss' as const, label: 'Dismiss — continue editing' },
    ];
    return (
      <Box flexDirection="column">
        <Text bold>Edit sections — save failed</Text>
        <Text color="red">{errMsg ?? 'Unknown error'}</Text>
        {showSettings && (
          <Box marginTop={1}>
            <Text dimColor>Several save failures — check API keys or disk space if relevant.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            items={saveErrItems}
            selectedIndex={saveErrMenuIdx}
            onChange={(i) => setSaveErrMenuIdx(i)}
            isActive={active}
            onSubmit={(item) => {
              if (item.value === 'settings') {
                setSaveFailStreak(0);
                navigate('settings');
                dispatch({ type: 'SET_FOCUS', target: 'content' });
                setPhase('ready');
                return;
              }
              if (item.value === 'dismiss') {
                setSaveFailStreak(0);
                setPhase('ready');
                return;
              }
              setSaveErrMenuIdx(0);
              void save();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (!profile) {
    return (
      <Box flexDirection="column">
        <Text color="red">No profile loaded</Text>
      </Box>
    );
  }

  if (phase === 'saving') {
    return (
      <Box flexDirection="column">
        <Text bold>Edit sections</Text>
        <Spinner label="Saving…" />
      </Box>
    );
  }

  if (!top) {
    return (
      <Box flexDirection="column">
        <Text color="red">Invalid navigation state</Text>
      </Box>
    );
  }

  const breadcrumb = stack.map((f) => {
    if (f.k === 'sections') {
      return 'Sections';
    }
    if (f.k === 'summary') {
      return 'Summary';
    }
    if (f.k === 'positions') {
      return 'Experience';
    }
    if (f.k === 'skills') {
      return 'Skills';
    }
    if (f.k === 'skill-edit') {
      const sk = profile.skills[f.skillIdx];
      return `Skill · ${sk?.name.value ?? '?'}`;
    }
    if (f.k === 'education') {
      return 'Education';
    }
    if (f.k === 'education-edit') {
      const e = profile.education[f.eduIdx];
      return `Education · ${e?.institution.value ?? '?'}`;
    }
    if (f.k === 'certifications') {
      return 'Certifications';
    }
    if (f.k === 'cert-edit') {
      const c = profile.certifications[f.certIdx];
      return `Cert · ${c?.name.value ?? '?'}`;
    }
    if (f.k === 'projects') {
      return 'Projects';
    }
    if (f.k === 'project-edit') {
      const pr = profile.projects[f.projIdx];
      return `Project · ${pr?.title.value ?? '?'}`;
    }
    if (f.k === 'bullets') {
      const pos = profile.positions[f.posIdx];
      const title = pos ? `${pos.title.value} @ ${pos.company.value}` : '?';
      return `Bullets · ${title}`;
    }
    if (f.k === 'bullet-edit') {
      const pos = profile.positions[f.posIdx];
      const title = pos ? `${pos.title.value}` : '?';
      return `Edit bullet · ${title} #${f.bulletIdx + 1}`;
    }
    return '?';
  });

  const sectionItems = [
    { value: 'summary', label: 'Summary' },
    { value: 'experience', label: 'Experience (positions & bullets)' },
    { value: 'skills', label: 'Skills' },
    { value: 'education', label: 'Education' },
    { value: 'certifications', label: 'Certifications' },
    { value: 'projects', label: 'Projects' },
  ];

  const positionItems = profile.positions.map((p, i) => ({
    value: String(i),
    label: `${p.title.value} @ ${p.company.value}`,
  }));

  return (
    <Box flexDirection="column">
      <Text bold>Edit sections</Text>
      <Text dimColor>
        {session ? 'Editing refined.json' : 'Editing source.json'}
        {dirty ? ' · unsaved changes' : ''}
      </Text>
      <Text dimColor>{breadcrumb.join(' › ')}</Text>
      {session && (
        <Text dimColor>
          Hiring-manager feedback on the whole profile: Refine menu → Professional consultant
          review.
        </Text>
      )}

      {unsaved && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
        >
          <Text bold color="yellow">
            Unsaved changes
          </Text>
        </Box>
      )}

      {top.k === 'sections' && (
        <Box marginTop={1} flexDirection="column">
          <SelectList
            items={sectionItems}
            selectedIndex={menuIdx}
            onChange={(i) => setMenuIdx(i)}
            isActive={active && !unsaved}
            onSubmit={(item) => {
              if (item.value === 'summary') {
                setStack((s) => [...s, { k: 'summary' }]);
                setMenuIdx(0);
              } else if (item.value === 'experience') {
                setStack((s) => [...s, { k: 'positions' }]);
                setMenuIdx(0);
              } else if (item.value === 'skills') {
                setStack((s) => [...s, { k: 'skills' }]);
                setMenuIdx(0);
              } else if (item.value === 'education') {
                setStack((s) => [...s, { k: 'education' }]);
                setMenuIdx(0);
              } else if (item.value === 'certifications') {
                setStack((s) => [...s, { k: 'certifications' }]);
                setMenuIdx(0);
              } else if (item.value === 'projects') {
                setStack((s) => [...s, { k: 'projects' }]);
                setMenuIdx(0);
              }
            }}
          />
        </Box>
      )}

      {top.k === 'summary' && (
        <Box marginTop={1} flexDirection="column">
          <Box marginTop={1}>
            <InlineEditor
              value={editingSummary ? summaryDraft : (profile.summary?.value ?? '')}
              onChange={setSummaryDraft}
              isEditing={editingSummary}
              inputFocused={active && editingSummary}
              emptyLabel="(no summary)"
              onSubmit={(v) => {
                const trimmed = v.trim();
                if (!trimmed) {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = { ...p };
                    delete next.summary;
                    return next;
                  });
                } else {
                  setProfile((p) => (p ? { ...p, summary: userEdit(trimmed) } : p));
                }
                setDirty(true);
                setEditingSummary(false);
              }}
            />
          </Box>
        </Box>
      )}

      {top.k === 'positions' && (
        <Box marginTop={1} flexDirection="column">
          {positionDeletePrompt && (
            <Box marginTop={1}>
              <ConfirmPrompt
                message="Delete this position (and all its bullets)?"
                active={active && positionDeletePrompt !== null}
                onConfirm={() => {
                  const ctx = positionDeletePrompt;
                  setPositionDeletePrompt(null);
                  if (!ctx) {
                    return;
                  }
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    if (ctx.posIdx < 0 || ctx.posIdx >= next.positions.length) {
                      return p;
                    }
                    next.positions.splice(ctx.posIdx, 1);
                    return next;
                  });
                  setDirty(true);
                  setMenuIdx((i) => {
                    if (i > ctx.posIdx) {
                      return i - 1;
                    }
                    if (i === ctx.posIdx) {
                      return Math.max(0, ctx.posIdx - 1);
                    }
                    return i;
                  });
                }}
                onCancel={() => {
                  setPositionDeletePrompt(null);
                }}
              />
            </Box>
          )}
          {positionItems.length === 0 ? (
            <Text dimColor>No positions — press a to add.</Text>
          ) : (
            <SelectList
              items={positionItems}
              selectedIndex={menuIdx}
              onChange={(i) => setMenuIdx(i)}
              isActive={active && !unsaved && !positionDeletePrompt}
              onSubmit={(item) => {
                const idx = Number.parseInt(item.value, 10);
                if (!Number.isNaN(idx)) {
                  setStack((s) => [...s, { k: 'bullets', posIdx: idx }]);
                  setMenuIdx(0);
                }
              }}
            />
          )}
        </Box>
      )}

      {top.k === 'skills' &&
        (() => {
          const skillItems = profile.skills.map((s, i) => ({
            value: String(i),
            label:
              s.name.value.length > 72
                ? `${s.name.value.slice(0, 72)}…`
                : s.name.value || '(empty)',
          }));
          return (
            <Box marginTop={1} flexDirection="column">
              {skillDeletePrompt && (
                <Box marginTop={1}>
                  <ConfirmPrompt
                    message="Delete this skill?"
                    active={active && skillDeletePrompt !== null}
                    onConfirm={() => {
                      const ctx = skillDeletePrompt;
                      setSkillDeletePrompt(null);
                      if (!ctx) {
                        return;
                      }
                      setProfile((p) => {
                        if (!p) {
                          return p;
                        }
                        const next = cloneProfile(p);
                        if (ctx.skillIdx < 0 || ctx.skillIdx >= next.skills.length) {
                          return p;
                        }
                        next.skills.splice(ctx.skillIdx, 1);
                        return next;
                      });
                      setDirty(true);
                      setMenuIdx((i) => {
                        if (i > ctx.skillIdx) {
                          return i - 1;
                        }
                        if (i === ctx.skillIdx) {
                          return Math.max(0, ctx.skillIdx - 1);
                        }
                        return i;
                      });
                    }}
                    onCancel={() => {
                      setSkillDeletePrompt(null);
                    }}
                  />
                </Box>
              )}
              {skillItems.length === 0 ? (
                <Text dimColor>No skills — press a to add.</Text>
              ) : (
                <SelectList
                  items={skillItems}
                  selectedIndex={menuIdx}
                  onChange={(i) => setMenuIdx(i)}
                  isActive={active && !unsaved && !skillDeletePrompt}
                  onSubmit={(item) => {
                    const si = Number.parseInt(item.value, 10);
                    if (!Number.isNaN(si)) {
                      setStack((s) => [...s, { k: 'skill-edit', skillIdx: si }]);
                    }
                  }}
                />
              )}
            </Box>
          );
        })()}

      {top.k === 'skill-edit' &&
        (() => {
          const sk = profile.skills[top.skillIdx];
          if (!sk) {
            return <Text color="red">Invalid skill.</Text>;
          }
          return (
            <Box marginTop={1} flexDirection="column">
              <InlineEditor
                value={sk.name.value}
                onChange={(v) => {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    const s = next.skills[top.skillIdx];
                    if (!s) {
                      return p;
                    }
                    s.name = userEdit(v);
                    return next;
                  });
                  setDirty(true);
                }}
                isEditing
                inputFocused={active}
                onSubmit={() => {
                  popStack();
                }}
              />
            </Box>
          );
        })()}

      {top.k === 'education' &&
        (() => {
          const eduItems = profile.education.map((e, i) => ({
            value: String(i),
            label:
              e.institution.value.length > 72
                ? `${e.institution.value.slice(0, 72)}…`
                : e.institution.value || '(no institution)',
          }));
          return (
            <Box marginTop={1} flexDirection="column">
              {eduDeletePrompt && (
                <Box marginTop={1}>
                  <ConfirmPrompt
                    message="Delete this education entry?"
                    active={active && eduDeletePrompt !== null}
                    onConfirm={() => {
                      const ctx = eduDeletePrompt;
                      setEduDeletePrompt(null);
                      if (!ctx) {
                        return;
                      }
                      setProfile((p) => {
                        if (!p) {
                          return p;
                        }
                        const next = cloneProfile(p);
                        if (ctx.eduIdx < 0 || ctx.eduIdx >= next.education.length) {
                          return p;
                        }
                        next.education.splice(ctx.eduIdx, 1);
                        return next;
                      });
                      setDirty(true);
                      setMenuIdx((i) => {
                        if (i > ctx.eduIdx) {
                          return i - 1;
                        }
                        if (i === ctx.eduIdx) {
                          return Math.max(0, ctx.eduIdx - 1);
                        }
                        return i;
                      });
                    }}
                    onCancel={() => {
                      setEduDeletePrompt(null);
                    }}
                  />
                </Box>
              )}
              {eduItems.length === 0 ? (
                <Text dimColor>No education entries — press a to add.</Text>
              ) : (
                <SelectList
                  items={eduItems}
                  selectedIndex={menuIdx}
                  onChange={(i) => setMenuIdx(i)}
                  isActive={active && !unsaved && !eduDeletePrompt}
                  onSubmit={(item) => {
                    const ei = Number.parseInt(item.value, 10);
                    if (!Number.isNaN(ei)) {
                      setStack((s) => [...s, { k: 'education-edit', eduIdx: ei }]);
                    }
                  }}
                />
              )}
            </Box>
          );
        })()}

      {top.k === 'education-edit' &&
        (() => {
          const e = profile.education[top.eduIdx];
          if (!e) {
            return <Text color="red">Invalid education entry.</Text>;
          }
          return (
            <Box marginTop={1} flexDirection="column">
              <InlineEditor
                value={e.institution.value}
                onChange={(v) => {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    const row = next.education[top.eduIdx];
                    if (!row) {
                      return p;
                    }
                    row.institution = userEdit(v);
                    return next;
                  });
                  setDirty(true);
                }}
                isEditing
                inputFocused={active}
                onSubmit={() => {
                  popStack();
                }}
              />
            </Box>
          );
        })()}

      {top.k === 'certifications' &&
        (() => {
          const certItems = profile.certifications.map((c, i) => ({
            value: String(i),
            label:
              c.name.value.length > 72
                ? `${c.name.value.slice(0, 72)}…`
                : c.name.value || '(empty)',
          }));
          return (
            <Box marginTop={1} flexDirection="column">
              {certDeletePrompt && (
                <Box marginTop={1}>
                  <ConfirmPrompt
                    message="Delete this certification?"
                    active={active && certDeletePrompt !== null}
                    onConfirm={() => {
                      const ctx = certDeletePrompt;
                      setCertDeletePrompt(null);
                      if (!ctx) {
                        return;
                      }
                      setProfile((p) => {
                        if (!p) {
                          return p;
                        }
                        const next = cloneProfile(p);
                        if (ctx.certIdx < 0 || ctx.certIdx >= next.certifications.length) {
                          return p;
                        }
                        next.certifications.splice(ctx.certIdx, 1);
                        return next;
                      });
                      setDirty(true);
                      setMenuIdx((i) => {
                        if (i > ctx.certIdx) {
                          return i - 1;
                        }
                        if (i === ctx.certIdx) {
                          return Math.max(0, ctx.certIdx - 1);
                        }
                        return i;
                      });
                    }}
                    onCancel={() => {
                      setCertDeletePrompt(null);
                    }}
                  />
                </Box>
              )}
              {certItems.length === 0 ? (
                <Text dimColor>No certifications — press a to add.</Text>
              ) : (
                <SelectList
                  items={certItems}
                  selectedIndex={menuIdx}
                  onChange={(i) => setMenuIdx(i)}
                  isActive={active && !unsaved && !certDeletePrompt}
                  onSubmit={(item) => {
                    const ci = Number.parseInt(item.value, 10);
                    if (!Number.isNaN(ci)) {
                      setStack((s) => [...s, { k: 'cert-edit', certIdx: ci }]);
                    }
                  }}
                />
              )}
            </Box>
          );
        })()}

      {top.k === 'cert-edit' &&
        (() => {
          const c = profile.certifications[top.certIdx];
          if (!c) {
            return <Text color="red">Invalid certification.</Text>;
          }
          return (
            <Box marginTop={1} flexDirection="column">
              <InlineEditor
                value={c.name.value}
                onChange={(v) => {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    const row = next.certifications[top.certIdx];
                    if (!row) {
                      return p;
                    }
                    row.name = userEdit(v);
                    return next;
                  });
                  setDirty(true);
                }}
                isEditing
                inputFocused={active}
                onSubmit={() => {
                  popStack();
                }}
              />
            </Box>
          );
        })()}

      {top.k === 'projects' &&
        (() => {
          const projItems = profile.projects.map((pr, i) => ({
            value: String(i),
            label:
              pr.title.value.length > 72
                ? `${pr.title.value.slice(0, 72)}…`
                : pr.title.value || '(empty)',
          }));
          return (
            <Box marginTop={1} flexDirection="column">
              {projDeletePrompt && (
                <Box marginTop={1}>
                  <ConfirmPrompt
                    message="Delete this project?"
                    active={active && projDeletePrompt !== null}
                    onConfirm={() => {
                      const ctx = projDeletePrompt;
                      setProjDeletePrompt(null);
                      if (!ctx) {
                        return;
                      }
                      setProfile((p) => {
                        if (!p) {
                          return p;
                        }
                        const next = cloneProfile(p);
                        if (ctx.projIdx < 0 || ctx.projIdx >= next.projects.length) {
                          return p;
                        }
                        next.projects.splice(ctx.projIdx, 1);
                        return next;
                      });
                      setDirty(true);
                      setMenuIdx((i) => {
                        if (i > ctx.projIdx) {
                          return i - 1;
                        }
                        if (i === ctx.projIdx) {
                          return Math.max(0, ctx.projIdx - 1);
                        }
                        return i;
                      });
                    }}
                    onCancel={() => {
                      setProjDeletePrompt(null);
                    }}
                  />
                </Box>
              )}
              {projItems.length === 0 ? (
                <Text dimColor>No projects — press a to add.</Text>
              ) : (
                <SelectList
                  items={projItems}
                  selectedIndex={menuIdx}
                  onChange={(i) => setMenuIdx(i)}
                  isActive={active && !unsaved && !projDeletePrompt}
                  onSubmit={(item) => {
                    const pi = Number.parseInt(item.value, 10);
                    if (!Number.isNaN(pi)) {
                      setStack((s) => [...s, { k: 'project-edit', projIdx: pi }]);
                    }
                  }}
                />
              )}
            </Box>
          );
        })()}

      {top.k === 'project-edit' &&
        (() => {
          const pr = profile.projects[top.projIdx];
          if (!pr) {
            return <Text color="red">Invalid project.</Text>;
          }
          return (
            <Box marginTop={1} flexDirection="column">
              <InlineEditor
                value={pr.title.value}
                onChange={(v) => {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    const row = next.projects[top.projIdx];
                    if (!row) {
                      return p;
                    }
                    row.title = userEdit(v);
                    return next;
                  });
                  setDirty(true);
                }}
                isEditing
                inputFocused={active}
                onSubmit={() => {
                  popStack();
                }}
              />
            </Box>
          );
        })()}

      {top.k === 'bullets' &&
        (() => {
          const pos = profile.positions[top.posIdx];
          if (!pos) {
            return <Text color="red">Invalid position.</Text>;
          }
          const bulletItems = pos.bullets.map((b, i) => ({
            value: String(i),
            label: b.value.length > 72 ? `${b.value.slice(0, 72)}…` : b.value || '(empty bullet)',
          }));
          return (
            <Box marginTop={1} flexDirection="column">
              {bulletDeletePrompt && (
                <Box marginTop={1}>
                  <ConfirmPrompt
                    message="Delete this bullet?"
                    active={active && bulletDeletePrompt !== null}
                    onConfirm={() => {
                      const ctx = bulletDeletePrompt;
                      setBulletDeletePrompt(null);
                      if (!ctx) {
                        return;
                      }
                      setProfile((p) => {
                        if (!p) {
                          return p;
                        }
                        const next = cloneProfile(p);
                        const np = next.positions[ctx.posIdx];
                        if (!np || ctx.bulletIdx < 0 || ctx.bulletIdx >= np.bullets.length) {
                          return p;
                        }
                        np.bullets.splice(ctx.bulletIdx, 1);
                        return next;
                      });
                      setDirty(true);
                      setMenuIdx((i) => {
                        if (i > ctx.bulletIdx) {
                          return i - 1;
                        }
                        if (i === ctx.bulletIdx) {
                          return Math.max(0, ctx.bulletIdx - 1);
                        }
                        return i;
                      });
                    }}
                    onCancel={() => {
                      setBulletDeletePrompt(null);
                    }}
                  />
                </Box>
              )}
              {bulletItems.length === 0 ? (
                <Text dimColor>No bullets — press a to add.</Text>
              ) : (
                <SelectList
                  items={bulletItems}
                  selectedIndex={menuIdx}
                  onChange={(i) => setMenuIdx(i)}
                  isActive={active && !unsaved && !bulletDeletePrompt}
                  onSubmit={(item) => {
                    const bi = Number.parseInt(item.value, 10);
                    if (!Number.isNaN(bi)) {
                      setStack((s) => [
                        ...s,
                        { k: 'bullet-edit', posIdx: top.posIdx, bulletIdx: bi },
                      ]);
                      setMenuIdx(0);
                    }
                  }}
                />
              )}
            </Box>
          );
        })()}

      {top.k === 'bullet-edit' &&
        (() => {
          const pos = profile.positions[top.posIdx];
          const bullet = pos?.bullets[top.bulletIdx];
          if (!pos || !bullet) {
            return <Text color="red">Invalid bullet.</Text>;
          }
          return (
            <Box marginTop={1} flexDirection="column">
              <InlineEditor
                value={bullet.value}
                onChange={(v) => {
                  setProfile((p) => {
                    if (!p) {
                      return p;
                    }
                    const next = cloneProfile(p);
                    const np = next.positions[top.posIdx];
                    if (!np?.bullets[top.bulletIdx]) {
                      return p;
                    }
                    np.bullets[top.bulletIdx] = userEdit(v);
                    return next;
                  });
                  setDirty(true);
                }}
                isEditing
                inputFocused={active}
                onSubmit={() => {
                  popStack();
                }}
              />
            </Box>
          );
        })()}
    </Box>
  );
}
