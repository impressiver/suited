# Dashboard & Editor Redesign

> **Status:** Design spec — pending implementation
> **Supersedes:** `tui-document-shell.md` §4 (Resume = editor), `tui-screens.md` CurateScreen (planned), RefineScreen as top-level screen
> **Related:** `tui-architecture.md`, `tui-ux.md`, `tui-screens.md`, `tui-document-shell.md`

---

## 1. Executive Summary

The TUI is restructured around three principles:

1. **Dashboard is a workflow hub** — a full-terminal visual summary showing pipeline status, profile identity, and navigation to every major function. No editor.
2. **The resume editor is a shared component** — `ResumeEditor` is used by both the general Editor screen (editing imported/refined content) and the Jobs screen (editing job-targeted content). Same UX, different data context.
3. **Refine is contextual, not a destination** — polish, consultant, Q&A, sniff, direct edit, and history are actions available inside the editor, not a separate screen. An onboarding flow chains them on first refinement.

---

## 2. Screen Structure

### New `SCREEN_ORDER`

```typescript
export const SCREEN_ORDER: ScreenId[] = [
  'dashboard',  // 1 — workflow hub
  'import',     // 2 — bring in resume data
  'contact',    // 3 — contact info
  'editor',     // 4 — edit general resume (NEW)
  'jobs',       // 5 — manage jobs + edit job-specific resumes
  'generate',   // 6 — produce PDFs
  'settings',   // 7 — API keys, output, defaults
];
```

**Added:** `editor`
**Removed from SCREEN_ORDER:** `refine` (absorbed into editor), `profile` (reachable from editor, not nav)

### Letter shortcuts

| Key | Screen |
|-----|--------|
| `d` | Dashboard |
| `i` | Import |
| `c` | Contact |
| `e` | Editor |
| `j` | Jobs |
| `g` | Generate |
| `s` | Settings |

`r` is freed. The existing `r → refine` mapping is removed.

### Overlay screens

`OVERLAY_NAV_SCREEN_IDS` updated: `['import', 'contact', 'settings', 'generate']`. These overlay on `dashboard`, `editor`, or `jobs` as underlays. Popping returns to the underlay.

### Esc behavior (global)

Esc cascades inward-to-outward:

1. If editor body is focused → blur editor (exit text input mode)
2. If an overlay flow is active (polish diff, Q&A, consultant) → cancel/close the overlay
3. If an overlay screen is stacked → pop overlay
4. If on a non-dashboard screen → navigate to dashboard
5. If on dashboard → no-op (already at top level)

**Invariant:** Esc always trends toward dashboard as the top level.

---

## 3. Dashboard — Workflow Hub

### Purpose

Visual summary of the user's current state. Shows what's done, what needs attention, and provides navigation to every function.

### Layout

```
┏━┓╻ ╻╻╺┳╸┏━╸╺┳┓
┗━┓┃ ┃┃ ┃ ┣╸  ┃┃
┗━┛┗━┛╹ ╹ ┗━╸╺┻┛
Dashboard
─────────────────────────────────────────────

  Ian Chen
  Full Stack Engineer · 12 positions · 47 skills

  ── Pipeline ───────────────────────────────

  ● Source       Imported from LinkedIn, Apr 1
  ● Refined      Last refined Apr 4
  ● Contact      ian@example.com · 6/7 fields
  ● Jobs         3 saved · 2 prepared
  ○ PDF          No PDFs generated yet

  ── Quick Actions ──────────────────────────

  › Edit resume                          e
    Add / manage jobs                    j
    Import new source                    i
    Update contact info                  c
    Generate PDF                         g
    Settings                             s

─────────────────────────────────────────────
Source ● Refined ● Jobs ● PDF ○       ? help
```

### Data sources

- `ProfileSnapshot` drives all status indicators
- Pipeline steps: filled dot (●) when complete, empty (○) when not
- Each step shows a one-line summary (date, count, or "not yet")
- Profile identity from `loadActiveProfile` (name, headline, counts)

### States

| State | Display |
|-------|---------|
| No source | Empty state: "Import a resume to get started" — Import as primary action |
| Source only | Emphasize "Edit resume" which triggers the onboarding flow |
| Refined | Full pipeline display, all actions available |
| Has jobs | Jobs line shows count and preparation status |
| Has PDFs | PDF line shows last generated filename/date |

### Behavior

- Action list is a `SelectList` — Enter navigates to that screen
- Letter shortcuts work globally
- No editor on this screen — purely informational + navigational
- Esc on dashboard: no-op (already at top level)

---

## 4. Shared `ResumeEditor` Component

### Location

`src/tui/components/ResumeEditor.tsx`

### Context

```typescript
interface ResumeEditorContextValue {
  mode: 'general' | 'job';
  /** Job description text — only in job mode */
  jobDescription?: string;
  /** Job metadata — only in job mode */
  jobTitle?: string;
  company?: string;
  jobId?: string;
  /** Where saves go */
  persistenceTarget: PersistenceTarget;
  /** Called when the user wants to leave the editor (Esc in nav mode) */
  onRequestClose: () => void;
}
```

A React context (`ResumeEditorProvider`) wraps the component. The hosting screen provides the values.

### Extracted from current `DashboardScreen`

- `FreeCursorMultilineInput` + all wiring (mdDraft, externalContentRevision, caret tracking, mouse/wheel)
- Section index, outline (`Ctrl+O` / `o` in nav mode), heading menus
- Polish (`Ctrl+P`), Consultant (`Ctrl+E`), Save (`Ctrl+S`)
- `EditorHint` notification
- Parse error display
- Inline polish diff (`DiffView` + accept/discard overlay)
- Read-only `TextViewport` fallback when `hasRefined` is false
- `loadRefinedTuiState` loading for the active `persistenceTarget`
- `saveRefinedForPersistenceTarget` save dispatch
- `resumeBodyFocused` / nav-mode toggle (Esc blurs, Tab refocuses)

### What the hosting screen provides

- `persistenceTarget` (general = `global-refined`, job = `{ kind: 'job', jobId, slug }`)
- `onRequestClose` (called on Esc in nav mode with no overlay active)
- Job metadata (for JD pane and context display)
- `snapshot` / `profileDir` (same as today)

### Editor dirty state

- `editorDirty: boolean` added to `AppState`
- `ResumeEditor` dispatches `SET_EDITOR_DIRTY` on text changes
- `App.tsx` shows confirm prompt on navigation away from dirty editor (same pattern as `profileEditorDirty`)
- Clears on save or intentional discard

### Refine tools as editor actions

All refine tools available inside the editor as **overlay states** — editor pauses, flow runs, resumes with updated content.

| Action | Trigger | Flow |
|--------|---------|------|
| Polish | `Ctrl+P` | Section-scoped (cursor position). Spinner → diff → accept/discard |
| Consultant | `Ctrl+E` | Section-scoped. Spinner → evaluation → pick findings → follow-up Q&A → apply → diff |
| AI Sniff | Palette `:sniff` | One-shot. Spinner → diff → accept/discard |
| Direct Edit | Palette `:edit` | MultilineInput for instructions → spinner → diff → accept/discard |
| Q&A Refinement | Palette `:qa` | Generate questions → answer each → apply → diff |
| History | Palette `:history` | List snapshots → confirm restore |
| Structured Edit | Palette `:sections` | Navigate to `ProfileEditorScreen` (returns to editor on Esc) |

**Consistency:** All available in both general and job-specific modes. Same keybinds and palette commands. Saves route through `persistenceTarget`.

### Job-specific additional actions

Available only when `mode === 'job'`, in nav mode only (editor body not focused):

| Action | Trigger | Description |
|--------|---------|-------------|
| Show/hide JD | `Ctrl+J` | Toggle job description pane |
| Prepare | `p` | Run curation pipeline for this job |
| Feedback | `f` | Professional job-fit evaluation |
| Generate | `g` | Open Generate with this job pre-selected |
| Cover letter | `l` | Cover letter editor overlay |

---

## 5. Collapsible JD Pane

When `mode === 'job'` and `jobDescription` is present.

### Toggle

`Ctrl+J` cycles: hidden → peek → full-screen → hidden

### Modes

| Mode | Behavior |
|------|----------|
| **Hidden** | Dim hint line: `Ctrl+J: show job description` |
| **Peek** | TextViewport above editor, ~1/3 of viewport height. PgUp/PgDn scroll JD. Editor retains arrow keys. |
| **Full** | JD replaces editor temporarily. Ctrl+J or Esc returns to editor. |

### Wide terminals (80+ cols)

Side-by-side layout option: JD on left, editor on right. Reuse `jobsUseSplitPane` logic.

### Rendering

`TextViewport` + `ScrollView` with word wrapping, same infrastructure as current `viewJd` in Jobs.

---

## 6. Editor Screen (General Resume)

### Screen ID

`'editor'` — new entry in `ScreenId`.

### Purpose

Edit the general/imported resume. Where the user refines base content before targeting for jobs.

### Implementation

Thin wrapper rendering `ResumeEditor` with general context:

```typescript
<ResumeEditorProvider value={{
  mode: 'general',
  persistenceTarget: globalRefinedTarget(),
  onRequestClose: () => navigate('dashboard'),
}}>
  <ResumeEditor snapshot={snapshot} profileDir={profileDir} />
</ResumeEditorProvider>
```

### No refined data — onboarding gate

When `hasRefined` is false:

- Show source as read-only markdown (`TextViewport`)
- Prominent CTA: "Press Enter to start refinement"
- Enter triggers the onboarding flow (§7)
- `:qa` from palette also works

### Esc cascade

1. Editor body focused → blur (nav mode)
2. Overlay active → cancel overlay
3. Nav mode, no overlay → navigate to dashboard

---

## 7. Onboarding Flow (First Refinement)

### Trigger

User enters Editor screen with source but no `refined.json`, presses Enter on the CTA.

### Sequence

Four passes chained, each with review:

1. **Q&A Refinement** — generate interview questions → user answers → apply → diff review → accept/discard → creates `refined.json`
2. **Polish** — AI polish on all sections → diff review → accept/discard
3. **Consultant** — professional review → evaluation → pick findings → follow-up Q&A → apply → diff review → accept/discard
4. **AI Sniff** — reduce AI phrasing → diff review → accept/discard

Each step:
- Brief explanation of what it does
- Spinner/progress during LLM work
- Results for review (diff, evaluation)
- Accept or discard
- Esc skips remaining steps

After completion (or skip), the editor opens with refined content for free editing.

### Post-onboarding

Each tool available individually via keybinds/palette. Onboarding is a one-time guided sequence, not a gate. Re-trigger via palette `:onboarding`.

---

## 8. Jobs Screen Changes

### Job list

Stays largely the same:

- `SelectList` of saved jobs with preparation status
- `a` — add new job (title → company → JD paste wizard)
- `d` — delete highlighted job (confirm prompt)
- Enter — select job → opens `ResumeEditor` in job mode
- Esc — navigate to dashboard

### Job selected → Editor

Selecting a job renders `ResumeEditor` within the Jobs screen:

```typescript
<ResumeEditorProvider value={{
  mode: 'job',
  jobDescription: selectedJob.text,
  jobTitle: selectedJob.title,
  company: selectedJob.company,
  jobId: selectedJob.id,
  persistenceTarget: jobRefinedTarget(selectedJob.id, makeJobSlug(...)),
  onRequestClose: () => setMode({ m: 'list' }),
}}>
  <ResumeEditor snapshot={snapshot} profileDir={profileDir} />
</ResumeEditorProvider>
```

### Esc cascade from job editor

1. Editor body focused → blur (nav mode)
2. Overlay active → cancel overlay
3. Nav mode → back to job list
4. Job list → dashboard

### What's removed

- Job detail menu — replaced by editor keybinds
- `viewJd` mode — replaced by JD pane (`Ctrl+J`)
- `prepareOk` / `viewPrep` scroll views — prepare results shown as overlay
- `feedbackView` / `feedbackApply` — launched from `f`, render as overlay

### Cover letter (`l`)

Opens cover letter editing overlay. `MultilineInput` for draft, refine/sniff actions. Same flow as current `coverLetterEdit` / `coverLetterReview` but as an overlay.

### Persistence

`SET_PERSISTENCE_TARGET` dispatches with job target on selection. `ResumeEditor` loads via `loadRefinedTuiState`. No job-scoped refined copy → initializes from global refined.

---

## 9. Removed / Superseded

### RefineScreen

**Removed as top-level screen.** All flows absorbed into `ResumeEditor` overlays:

| Former RefineScreen state | New location |
|--------------------------|--------------|
| `first-refine-menu` | Editor: no-refined gate + onboarding CTA |
| `has-refined-menu` | Editor: palette commands + keybinds |
| Q&A flow | Editor overlay via `:qa` or onboarding |
| Polish | Editor overlay via `Ctrl+P` |
| AI Sniff | Editor overlay via `:sniff` |
| Consultant | Editor overlay via `Ctrl+E` |
| Direct edit | Editor overlay via `:edit` |
| History | Editor overlay via `:history` |
| `syncing-md` (isMdNewerThanJson) | Editor: sync check on load |
| `ProfileEditorScreen` navigation | Editor: `:sections` palette command |

### CurateScreen (planned)

**Superseded.** Jobs screen + `ResumeEditor` in job mode covers all planned curate functionality. "Clear and start over" → palette `:reset-job`.

### `refineResumeIntent`

**Removed from store.** Editor's section-aware keybinds (cursor position determines scope) replace the intent handoff.

---

## 10. Edge Cases

### No refined data + editor screen

Editor shows read-only source with onboarding CTA. `FreeCursorMultilineInput` only activates after refined data exists.

### Persistence target on screen switch

Editor screen always uses `global-refined`. Jobs screen sets job target on selection, clears to global on return to list. No ambiguity — each screen owns its target.

### Dirty state across screens

Each `ResumeEditor` instance has its own local state. Store-level `editorDirty` flag gates navigation. On switch from Editor → Jobs (or vice versa), confirm prompt if dirty.

### isMdNewerThanJson sync

Editor checks on load. If external edits detected, shows sync prompt before entering edit mode. Same flow as current RefineScreen `syncing-md`.

### Keybind collisions

- `p` (prepare) vs `Ctrl+P` (polish): no collision — bare letter vs Ctrl-modified
- Bare letter keybinds (`p`, `f`, `g`, `l`) only fire in nav mode (`inTextInput` false)
- Editor body focused → all bare letters type into the editor

---

## 11. Implementation Phases

### Phase 1: Extract `ResumeEditor` component

- Extract editor logic from `DashboardScreen` into `ResumeEditor.tsx`
- Create `ResumeEditorContext` with provider
- `DashboardScreen` wraps `ResumeEditor` with `mode: 'general'` — no nav changes
- Add `editorDirty` to store + navigation guard
- Tests: editor renders, saves, polish/consultant work

### Phase 2: Dashboard hub + Editor screen

- Add `'editor'` to `ScreenId` and `SCREEN_ORDER`
- Implement `DashboardScreen` as workflow hub
- Implement `EditorScreen` wrapping `ResumeEditor`
- Update letter map, overlay screen list, Esc cascade
- Dashboard as default; Esc from editor → dashboard

### Phase 3: Absorb refine flows into editor

- Port RefineScreen state machines into editor overlay states
- Implement overlay rendering (Q&A, consultant, sniff, direct edit, history)
- Add palette commands
- Implement onboarding flow
- Implement isMdNewerThanJson sync check
- Remove `RefineScreen`, `refine` ScreenId, `refineResumeIntent`

### Phase 4: Jobs + JD pane

- Implement JD pane (Ctrl+J toggle, three modes, wide-terminal split)
- Jobs: select job → `ResumeEditor` with job context
- Port job keybinds (p/f/g/l) into editor nav mode
- Port cover letter editing as overlay
- Remove job detail menu
- Remove CurateScreen from specs

---

## 12. Spec Files to Update

| File | Change |
|------|--------|
| `tui-document-shell.md` §4 | Dashboard = hub, Editor = separate screen |
| `tui-document-shell.md` §8 | Section model lives in `ResumeEditor`, not DashboardScreen |
| `tui-screens.md` | Remove RefineScreen, update DashboardScreen, add EditorScreen, update JobsScreen, remove CurateScreen |
| `tui-architecture.md` | Update SCREEN_ORDER, letter map, Esc cascade, component hierarchy |
| `tui-ux.md` | Update flow diagram, remove Curate/Refine as boxes |
| `types.ts` | Add `'editor'`, remove `'refine'`. Update `SCREEN_ORDER`, `NAV_LABELS`, `OVERLAY_NAV_SCREEN_IDS` |
