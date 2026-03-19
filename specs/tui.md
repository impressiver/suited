# TUI Implementation Plan

**Relationship to today’s CLI:** `suited` with no subcommand currently runs **`runDashboard`** (`src/commands/dashboard.ts`, inquirer). This document specifies a **full-screen Ink TUI** intended to replace that interactive layer only; domain logic in `generate/`, `profile/`, `claude/`, and `ingestion/` stays unchanged. See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Library: Ink v5 (React-based terminal rendering)

**Why Ink:**
- TypeScript-first, pure ESM — matches the existing stack exactly
- React component model maps naturally to the 8 screens needed
- `useEffect`/`useState` handles async ops, streaming, and deferred loading cleanly
- Diff display is just a `<DiffView>` component — no manual cursor management

**Key principle:** The TUI is a pure UI replacement. All business logic in `generate/`, `profile/`, `claude/`, `ingestion/` stays untouched. Only the I/O layer (`src/commands/`) gets a TUI counterpart.

---

## UX & workflow

The CLI’s mental model is **Import → Refine → Generate**. The TUI exposes **eight peer screens** for power users; balance that with **pipeline clarity** so it does not feel like a flat launcher.

- **Pipeline status** — Derive from loaded profile data (e.g. source present, `refined.json` exists, at least one job / last PDF). Show compact indicators in **Header** (and optionally **Dashboard**) so users always know where they are in the flow.
- **Suggested next step** — **Dashboard** highlights one primary action (e.g. “Import source,” “Run refine,” “Generate for a job”) from state, not only static quick-action cards. Secondary actions remain available via sidebar.
- **First-run / blocked states** — If there is no API key (or no usable provider config), show a **blocking banner** on Dashboard with a single path to **Settings** (or env instructions). If there is no imported source, the suggested next step is **Import**; avoid dead-end empty dashboards.

**Discoverability:** `1–8` jumps are fast but not mnemonic. Also support **single-letter shortcuts** where they do not conflict (e.g. `g` → Generate, `j` → Jobs, `i` → Import, `d` → Dashboard, `r` → Refine, `p` → Profile, `c` → Contact, `s` → Settings — finalize in implementation to avoid clashes with text fields). Optionally add a **command palette** (`:` or `/`) that fuzzy-finds screens and actions for users who forget shortcuts.

---

## Directory Structure

```
src/tui/
  index.tsx                   ← Ink app root
  App.tsx                     ← Screen router, global keybindings
  store.ts                    ← Context + useReducer global state
  hooks/
    useProfile.ts             ← Load/watch profile files
    useAsyncOp.ts             ← Generic async op with status/error
    useKeymap.ts              ← Navigation bindings
    useStreaming.ts           ← Accumulate streaming Claude output
  components/
    layout/
      Header.tsx              ← Profile status bar (top)
      Footer.tsx              ← Key hints (context-sensitive)
      Sidebar.tsx             ← Nav menu panel
      ContentArea.tsx         ← Right-side content region
      Layout.tsx              ← Composes all layout pieces
    shared/
      Spinner.tsx
      DiffView.tsx            ← +/- diff blocks (color optional) + accept/edit/keep
      ProgressSteps.tsx       ← Step 1/4 → 2/4 visual indicator
      TextInput.tsx
      MultilineInput.tsx      ← JD paste area
      SelectList.tsx          ← Replaces inquirer list
      CheckboxList.tsx        ← Replaces inquirer checkbox
      StatusBadge.tsx
      ScrollView.tsx
  screens/
    DashboardScreen.tsx
    ImportScreen.tsx
    RefineScreen.tsx          ← Most complex: Q&A + diff review state machine
    GenerateScreen.tsx
    JobsScreen.tsx
    ProfileEditorScreen.tsx
    ContactScreen.tsx
    SettingsScreen.tsx
```

~31 new files, ~5,000–7,000 lines total.

---

## Modified Files (only 2)

| File | Change |
|---|---|
| `src/index.ts` | Add `runTui()` when no subcommand + interactive TTY (stdin **and** stdout); else existing CLI behavior |
| `src/claude/client.ts` | Add `callWithToolStreaming()` export alongside existing `callWithTool` |

All `src/commands/` files remain unchanged — `suited import`, `suited refine`, etc. still work.

---

## Key Architecture Decisions

**Global state** (`store.ts`): `useReducer` + Context — tracks active screen, loaded profile, focus target (sidebar vs content), and `operationInProgress` flag that suppresses **sidebar / screen-jump** navigation during async ops (content may still scroll). Start simple; if cross-screen shared state grows, extracting a small external store is an implementation detail — **do not** rewrite screens for it up front.

```typescript
interface AppState {
  profileDir: string;
  profile: Profile | null;
  hasRefined: boolean;
  activeScreen: Screen;
  focusTarget: 'sidebar' | 'content';
  operationInProgress: boolean;
}

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_PROFILE'; profile: Profile; hasRefined: boolean }
  | { type: 'SET_FOCUS'; target: 'sidebar' | 'content' }
  | { type: 'SET_OPERATION_IN_PROGRESS'; value: boolean };
```

**Keyboard model:**

| Key | Behavior |
|---|---|
| `Tab` | Toggle focus sidebar ↔ content |
| `↑↓` | Move selection in focused panel |
| `Enter` | Confirm / activate |
| `Esc` | Back / cancel **modal**; during long-running ops, **cancel** if the op supports `AbortSignal` (see below) |
| `1–8` | Direct screen jump (when not typing; suppressed like `q` during text input) |
| Letter shortcuts | Jump to screen when not in text input (see UX section); must not steal keys from `<TextInput>` / `<MultilineInput>` |
| `:` or `/` | Optional: open command palette (screen search) |
| `q` | Quit (suppressed during input) |
| `Ctrl+C` | Hard exit (always works) |

**Footer (context-sensitive):** The **example** line in the component hierarchy is not global copy. Define rules per mode so the UI stays predictable:

| Mode | Footer emphasis |
|---|---|
| Default navigation | Navigate, Enter, Tab, screen jumps, Quit |
| Text / multiline input | Enter = submit or newline (per widget), Esc = blur/cancel, **no** accidental `q` quit |
| Async (scrape, save, non-streaming API) | Spinner + **Esc = cancel** when `AbortSignal` is wired; otherwise Esc = back only + message that cancel is not available |
| Streaming (LLM text) | Reading stream + optional cancel; clarify whether Ctrl+C kills process or only stream |
| Diff / bullet review | Per-block actions; Esc = exit step or go back to previous sub-state |

**Streaming output:** Add `callWithToolStreaming()` to `claude/client.ts` using `client.messages.stream()`. The `useStreaming` hook accumulates text deltas for live display in `<ScrollView>`.

Real flows interleave **text**, **tool use**, and **completion**. The generator should yield structured events (not only raw text) so the UI can show a stable line (e.g. “Calling tool…”) instead of flashing partial JSON:

```typescript
export async function* callWithToolStreaming<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model = 'claude-sonnet-4-6',
): AsyncGenerator<
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; result: T }
>
```

Document **cancellation**: pass `AbortSignal` from the TUI into stream/read calls where the SDK allows; map **Esc** to abort when safe, **Ctrl+C** always exits the process.

**Long-running ops:** `useAsyncOp` hook wraps any `Promise` — tracks `idle/running/done/error`. During `running`, global `operationInProgress` blocks **sidebar and screen-jump** navigation; offer **Esc** to cancel when the underlying op accepts `AbortSignal` so users are not trapped during long scrapes.

```typescript
function useAsyncOp<T>() {
  // state: { status: 'idle' | 'running' | 'done' | 'error', result: T | null, error: string | null }
  // returns: { ...state, run: (fn: () => Promise<T>) => void }
}
```

---

## Component Hierarchy

```
<App>                          ← global state, keyboard router
  <Layout>
    <Header />                 ← "Suited  ·  Jane Smith  ·  12 positions  ·  refined"
    <Box flexDirection="row">
      <Sidebar                 ← navigation items, highlights active
        items={NAV_ITEMS}
        activeScreen={screen}
        onSelect={setScreen}
      />
      <ContentArea>            ← flex:1, scrollable
        {screen === 'dashboard'     && <DashboardScreen />}
        {screen === 'import'        && <ImportScreen />}
        {screen === 'refine'        && <RefineScreen />}
        {screen === 'generate'      && <GenerateScreen />}
        {screen === 'jobs'          && <JobsScreen />}
        {screen === 'profile'       && <ProfileEditorScreen />}
        {screen === 'contact'       && <ContactScreen />}
        {screen === 'settings'      && <SettingsScreen />}
      </ContentArea>
    </Box>
    <Footer />                 ← context-sensitive; see Keyboard / Footer table
  </Layout>
</App>
```

---

## Terminal & environment

- **TTY gate:** `runTui()` only when stdin is a TTY **and** stdout is a TTY (and no conflicting flags). If not interactive, **fall through** to existing subcommand / help behavior — never hang waiting for keys. Print a one-line hint when `suited` is run with no args in CI: e.g. `suited --help` or `suited refine`.
- **Size:** Target **≥80×24** for the full sidebar + content layout. Below **80 columns**, switch **Jobs** and similar two-panel screens to **stacked** layout (list above detail, or detail below with scroll). Below **24 rows**, prefer shorter Header/Footer or single-line hints.
- **Paste:** `<MultilineInput>` (JD, etc.) should show a **short hint** (e.g. how to finish: dedicated “Done” action or key). Optionally show **character count** or a soft length warning before starting expensive API steps.

---

## Failure, recovery, and resume

- **Idempotent commands:** Prefer re-running CLI-backed operations (refine/generate) over inventing new persistence; surface **clear error lines** and **Retry** on Refine/Generate/Import when the underlying command fails mid-flight.
- **Partial outputs:** If the app writes intermediate files today, the TUI should **reflect** them on reload; if not, do not fake “resume” — show failure and suggest re-run from last good step.
- **Streaming/tool errors:** Distinguish **user-cancelled**, **API error**, and **parse error** in the UI copy so users know whether to retry, fix keys, or edit input.

---

## Testing

- Add **lightweight** integration coverage for **keyboard routing** and **critical flows** (e.g. open Dashboard → navigate to Settings) using `ink-testing-library` or equivalent; golden/snapshot tests optional for layout stability.
- Regression-prone areas: **global keymap**, **focus** (sidebar vs content vs input), **footer** text per mode.

---

## Screen Details

### DashboardScreen
Reads `source.json` and `refined.json` via `loadSource()` / `loadRefined()` on mount. Displays profile name, position/skill counts, refined badge, last PDF info, **pipeline/suggested next step**, quick-action cards, recent activity.

### ImportScreen
State machine: `idle → input → detecting → scraping → parsing → done | error`

Uses `useAsyncOp` for `scrapeLinkedInProfile()` (long-running, no streaming). Input form includes headed-mode checkbox for 2FA scenarios.

### RefineScreen
Most complex screen. State machine:
```
idle
  → checking-source
  → already-refined (sub-menu: consultant, polish, prompt, edit, manual, jobs, rerun)
  → generating-questions
  → qa-phase           (questions one by one via <TextInput>)
  → generating-refinements
  → diff-review        (<DiffView> blocks, accept/review/discard per change)
  → bullet-review      (per-bullet accept/edit/keep loop)
  → saving
  → done
```

`<DiffView>` renders pairs of `[-old]` and `[+new]` with a 3-option selector per block. **Accessibility:** do not rely on color alone — use **prefix symbols**, **bold/dim**, or both; red/green may supplement for terminals that support it.

### GenerateScreen
State machine:
```
idle → jd-input → analyzing-jd (1/4) → jd-confirmed → curating (2/4)
     → curation-preview → polishing (3/4) → consulting (4/4)
     → section-selection → generating-pdf → done
```

Template picker: `<SelectList>` with 5 options. Flair picker: 1–5 selector.

### JobsScreen
Two-panel layout at normal width: left = `<SelectList>` of saved jobs with status badges; right = detail panel with company, title, date, JD preview. **Narrow terminals:** stack list above detail (see Terminal & environment). Actions: Add (`<MultilineInput>`), Delete (confirmation), View (scroll).

### ProfileEditorScreen
Nested navigation: section list → section editor. Sub-components:
- `<SummaryEditor>` — single text input
- `<ExperienceEditor>` → `<PositionEditor>` → `<BulletsEditor>`
- `<SkillsEditor>` — tag cloud, add/remove
- `<EducationEditor>`, `<CertificationsEditor>`, `<ProjectsEditor>` — list + form

### ContactScreen
Simple form with 8 labeled `<TextInput>` fields. Terminals have weak “blur” semantics — prefer **explicit save**: e.g. **Enter** on a field saves that field (or moves focus) + optional **“Save all”** action; avoid relying on blur alone for persistence.

### SettingsScreen
Shows/edits: API key (masked), output directory, default flair, browser headed mode. Writes to `.env`. Implement early enough that **first-run / missing key** flows can point here from Dashboard; priority is “low” only for **polish**, not for **unblocking** API use.

---

## Build Changes

1. Add dependencies (pin majors in `package.json`; align **React** with Ink’s peer range — Ink does not use `react-dom`):
   ```
   pnpm add ink react ink-text-input
   pnpm add -D @types/react
   ```

2. `tsconfig.json` additions:
   ```json
   {
     "compilerOptions": {
       "jsx": "react-jsx",
       "jsxImportSource": "react"
     }
   }
   ```

3. Biome already supports TSX natively (v2).

4. Existing build script (`tsc && cp -r src/templates dist/templates`) needs no changes.

---

## Implementation Order

1. **Infrastructure** — Install Ink, configure tsconfig JSX, create `store.ts`, `App.tsx`, `Layout.tsx` with placeholder screens. Verify Tab/q keys work; verify **non-TTY** falls back to CLI without hanging.
2. **Shared components** — `Spinner`, `SelectList`, `TextInput`, `StatusBadge`, `ScrollView`. Independent, testable in isolation.
3. **DashboardScreen** — Data display + **pipeline / suggested next step** + blocked/API banner. Validates `useProfile` hook.
4. **SettingsScreen (minimal)** — Enough to set API key and exit so Dashboard banner and flows can be tested end-to-end. Full polish (copy, validation) can follow later.
5. **ContactScreen** — Simple form with **explicit save** model. Validates save-then-reload end to end.
6. **ImportScreen** — First async op. Validates `useAsyncOp`, `ProgressSteps`, and **Esc/cancel** when supported.
7. **JobsScreen** — Two-panel + **narrow stacked** layout. Validates `CheckboxList` and list CRUD.
8. **ProfileEditorScreen** — Nested navigation. Validates back-stack pattern.
9. **RefineScreen** — State machine + `DiffView` (non-color-only cues).
10. **GenerateScreen** — Similar patterns to Refine.
11. **Streaming** — Add `callWithToolStreaming` to `claude/client.ts` (text + tool events), wire into Refine/Generate; **AbortSignal** + footer copy.
12. **Footer / keymap polish** — Letter shortcuts, optional command palette, integration tests for critical paths.

---

## Scope Estimate

| Category | Count |
|---|---|
| New screen components | 8 |
| New shared components | 11 |
| New hooks | 4 |
| New layout components | 5 |
| New infrastructure files | 3 |
| Modified files | 2 |
| **Total new files** | **~31** |
