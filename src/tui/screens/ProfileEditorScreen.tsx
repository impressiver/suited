import { randomUUID } from 'node:crypto';
import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { profileToMarkdown } from '../../profile/markdown.ts';
import type { Profile, RefinementSession, Sourced } from '../../profile/schema.ts';
import {
  loadRefined,
  loadSource,
  refinedJsonPath,
  refinedMdPath,
  saveRefined,
  saveSource,
  sourceJsonPath,
  sourceMdPath,
} from '../../profile/serializer.ts';
import { fileExists } from '../../utils/fs.ts';
import { ConfirmPrompt, InlineEditor, SelectList, Spinner } from '../components/shared/index.ts';
import { useAppDispatch, useAppState } from '../store.tsx';

function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

function userEdit(value: string): Sourced<string> {
  const now = new Date().toISOString();
  return { value, source: { kind: 'user-edit', editedAt: now } };
}

async function persistProfile(
  profile: Profile,
  profileDir: string,
  session: RefinementSession | null,
): Promise<void> {
  if (session) {
    await saveRefined({ profile, session }, profileDir);
    await profileToMarkdown(profile, refinedMdPath(profileDir));
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
  | { k: 'skill-edit'; skillIdx: number };

type UnsavedAction = { action: 'pop' | 'sidebar' };

export interface ProfileEditorScreenProps {
  profileDir: string;
}

export function ProfileEditorScreen({ profileDir }: ProfileEditorScreenProps) {
  const dispatch = useAppDispatch();
  const { activeScreen, focusTarget, inTextInput } = useAppState();
  const active = activeScreen === 'profile' && focusTarget === 'content';

  const [phase, setPhase] = useState<'loading' | 'no-source' | 'ready' | 'saving' | 'err'>(
    'loading',
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<RefinementSession | null>(null);
  const baselineRef = useRef<Profile | null>(null);
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
  const top = stack.at(-1);

  useEffect(() => {
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
      } catch (e) {
        setErrMsg((e as Error).message);
        setPhase('err');
      }
    })();
  }, [profileDir]);

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
    } catch (e) {
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
    dispatch({ type: 'SET_FOCUS', target: 'sidebar' });
  }, [dirty, dispatch, popStack, stack.length]);

  useInput(
    (input, key) => {
      if (!active || phase !== 'ready' || unsaved || !profile) {
        return;
      }
      if (bulletDeletePrompt || skillDeletePrompt) {
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
      const isEnter = Boolean(key.return) || input === '\n' || input === '\r';
      if (top?.k === 'summary' && !editingSummary && isEnter) {
        setSummaryDraft(profile.summary?.value ?? '');
        setEditingSummary(true);
        return;
      }
      if (inTextInput) {
        return;
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
            const bs = np.bullets;
            const tmp = bs[bi - 1]!;
            bs[bi - 1] = bs[bi]!;
            bs[bi] = tmp;
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
            const bs = np.bullets;
            const tmp = bs[bi]!;
            bs[bi] = bs[bi + 1]!;
            bs[bi + 1] = tmp;
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
            const sk = next.skills;
            const tmp = sk[si - 1]!;
            sk[si - 1] = sk[si]!;
            sk[si] = tmp;
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
            const sk = next.skills;
            const tmp = sk[si]!;
            sk[si] = sk[si + 1]!;
            sk[si + 1] = tmp;
            return next;
          });
          setDirty(true);
          setMenuIdx(si + 1);
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
        <Text bold>Improve profile</Text>
        <Spinner label="Loading…" />
      </Box>
    );
  }

  if (phase === 'no-source') {
    return (
      <Box flexDirection="column">
        <Text bold>Improve profile</Text>
        <Text color="yellow">No source.json — import a profile first.</Text>
      </Box>
    );
  }

  if (phase === 'err' || !profile) {
    return (
      <Box flexDirection="column">
        <Text bold>Improve profile</Text>
        <Text color="red">{errMsg ?? 'Unknown error'}</Text>
      </Box>
    );
  }

  if (phase === 'saving') {
    return (
      <Box flexDirection="column">
        <Text bold>Improve profile</Text>
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
    if (f.k === 'bullets') {
      const pos = profile.positions[f.posIdx];
      const title = pos ? `${pos.title.value} @ ${pos.company.value}` : '?';
      return `Bullets · ${title}`;
    }
    const pos = profile.positions[f.posIdx];
    const title = pos ? `${pos.title.value}` : '?';
    return `Edit bullet · ${title} #${f.bulletIdx + 1}`;
  });

  const sectionItems = [
    { value: 'summary', label: 'Summary' },
    { value: 'experience', label: 'Experience (positions & bullets)' },
    { value: 'skills', label: 'Skills' },
  ];

  const positionItems = profile.positions.map((p, i) => ({
    value: String(i),
    label: `${p.title.value} @ ${p.company.value}`,
  }));

  return (
    <Box flexDirection="column">
      <Text bold>Improve profile</Text>
      <Text dimColor>
        {session ? 'Editing refined.json' : 'Editing source.json'} · Esc back · s save
        {dirty ? ' · unsaved changes' : ''}
      </Text>
      <Text dimColor>{breadcrumb.join(' › ')}</Text>

      {unsaved && (
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">
            Unsaved changes
          </Text>
          <Text dimColor>s save and continue · d/n discard and continue · Esc stay</Text>
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
              }
            }}
          />
        </Box>
      )}

      {top.k === 'summary' && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Enter edit · Esc cancel edit</Text>
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
                  setProfile((p) =>
                    p ? { ...p, summary: userEdit(trimmed) } : p,
                  );
                }
                setDirty(true);
                setEditingSummary(false);
              }}
            />
          </Box>
          {!editingSummary && (
            <Box marginTop={1}>
              <Text dimColor>Press Enter to edit</Text>
            </Box>
          )}
        </Box>
      )}

      {top.k === 'positions' && (
        <Box marginTop={1} flexDirection="column">
          {positionItems.length === 0 ? (
            <Text dimColor>No positions in profile.</Text>
          ) : (
            <SelectList
              items={positionItems}
              selectedIndex={menuIdx}
              onChange={(i) => setMenuIdx(i)}
              isActive={active && !unsaved}
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

      {top.k === 'skills' && (() => {
        const skillItems = profile.skills.map((s, i) => ({
          value: String(i),
          label: s.name.value.length > 72 ? `${s.name.value.slice(0, 72)}…` : s.name.value || '(empty)',
        }));
        return (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              ↑↓ select · [ ] move up/down · a add · d delete · Enter edit name
            </Text>
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

      {top.k === 'skill-edit' && (() => {
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
            <Box marginTop={1}>
              <Text dimColor>Enter save · Esc back</Text>
            </Box>
          </Box>
        );
      })()}

      {top.k === 'bullets' && (() => {
        const pos = profile.positions[top.posIdx];
        if (!pos) {
          return <Text color="red">Invalid position.</Text>;
        }
        const bulletItems = pos.bullets.map((b, i) => ({
          value: String(i),
          label:
            b.value.length > 72 ? `${b.value.slice(0, 72)}…` : b.value || '(empty bullet)',
        }));
        return (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              ↑↓ select · [ ] move up/down · a add · d delete · Enter edit
            </Text>
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
                    setStack((s) => [...s, { k: 'bullet-edit', posIdx: top.posIdx, bulletIdx: bi }]);
                    setMenuIdx(0);
                  }
                }}
              />
            )}
          </Box>
        );
      })()}

      {top.k === 'bullet-edit' && (() => {
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
            <Box marginTop={1}>
              <Text dimColor>Enter save · Esc cancel</Text>
            </Box>
          </Box>
        );
      })()}
    </Box>
  );
}
