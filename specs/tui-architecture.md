# Architecture

> **Target UI:** **[`tui-document-shell.md`](./tui-document-shell.md)** defines the shell (TopBar, StatusBar, **active document session**, palette, overlays, section context). **[`dashboard-editor-redesign.md`](./dashboard-editor-redesign.md)** defines the screen restructure: Dashboard as workflow hub, Editor as a new screen with shared `ResumeEditor` component, Refine absorbed into editor, CurateScreen superseded. This file remains authoritative for **`useInput`** discipline, **blocking UI**, **streaming**, and **shared components**.

## Target additions to global state (document shell)

**In store today:** **`persistenceTarget`**, **`paletteOpen`**, **`overlayStack`** + **`getEffectiveScreen`** (see `src/tui/store.tsx`). **TopBar / main panel** use the **effective** screen (top overlay if any, else **`activeScreen`**). **Still illustrative / not wired:**

- **`shellScreen`:** `'resume' | 'import' | …` — could collapse **`activeScreen`** + **`overlayStack`** later.
- **`focusedSectionId`:** optional `ResumeSectionId` — scroll highlight + scope for scoped actions.
- **`helpOpen`:** still local to `App.tsx` (not store); Ctrl-? overlay per document shell.

**Invariant:** all mutations to the active resume body flow through the **session profile** and **one save dispatch** per `persistenceTarget` (see document shell §7).

Legacy fields (`activeScreen`, `focusTarget`, `SCREEN_ORDER` jumps) **MAY** remain until overlay routing and palette fully replace screen stacking; default **`focusTarget`** is **`content`** (sidebar removed from layout).

---

## Global state (`store.ts`) — current shipped shape

`useReducer` + Context. Tracks active screen, loaded profile, focus target, `operationInProgress` (suppresses screen-jump during async; content may still scroll), optional `lastError`, **document session** target, palette.

```typescript
interface AppState {
  profileDir: string;
  profile: Profile | null;
  hasRefined: boolean;
  activeScreen: Screen;
  focusTarget: string; // legacy; default 'content' without sidebar
  inTextInput: boolean;
  operationInProgress: boolean;
  lastError: string | null;
  pendingJobId: string | null;
  blockingUiDepth: number;
  persistenceTarget: PersistenceTarget; // global-refined | job
  paletteOpen: boolean;
  overlayStack: ScreenId[];
}

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_PALETTE_OPEN'; open: boolean }
  | { type: 'PUSH_OVERLAY'; screen: Screen }
  | { type: 'POP_OVERLAY' }
  | { type: 'CLEAR_OVERLAYS' }
  | { type: 'SET_PERSISTENCE_TARGET'; target: PersistenceTarget }
  // … SET_PROFILE, SET_FOCUS, SET_IN_TEXT_INPUT, SET_OPERATION_IN_PROGRESS,
  // SET_ERROR, SET_PENDING_JOB, CANCEL_OPERATION, profile editor flags, blocking UI, …
```

See **`src/tui/store.tsx`** for the full discriminated union.

`pendingJobId` solves the Jobs → Generate navigation: `JobsScreen` dispatches `SET_SCREEN + SET_PENDING_JOB`, then `GenerateScreen` reads and clears it on mount.

Start simple. Cross-screen state growth is an implementation detail.

**Concurrency:** Only **one** async pipeline at a time **SHOULD** hold `operationInProgress` globally unless explicitly designed otherwise (e.g. background refresh is read-only and does not lock navigation).

---

## Keyboard model

| Key | Behavior |
|-----|----------|
| `Tab` | Advance focus to next region in active screen's Tab order. **Exception:** on **Resume** with refined markdown, **Tab** refocuses the body editor after **Esc** left **navigation mode** (see [`tui-document-shell.md`](./tui-document-shell.md) §8). |
| `Shift+Tab` | Previous focus region. In Ink, detect via raw escape sequence `\x1b[Z` inside `useInput`; terminal support varies — treat as best-effort. |
| `↑↓` | Move selection in focused list or diff block |
| `Enter` | Confirm / activate; submit single-line input |
| `Esc` | **Generate** / **Jobs** handle inner back first; else **`POP_OVERLAY`** when **`overlayStack`** non-empty; else go to **Resume** (`dashboard`) from other full screens. On **Resume** refined editor, **Esc** first blurs the markdown body (clears **`inTextInput`**) so **:** / **1–n** / letter jumps work; a second **Esc** from an already-unfocused **dashboard** is a no-op for navigation. |
| `1–n` | Direct jump via `SCREEN_ORDER` (`n` = row count; **↑↓** screen-cycle suppressed while an overlay is open; suppressed when `operationInProgress` or `inTextInput`) |
| Letter shortcuts | Screen jump per implementation map (`d i c e j g s`; same suppression; **`p`** is not global — Jobs uses **`p`** for prepare when deferred). `r` freed (Refine absorbed into editor). `e` → Editor. Curate superseded. |
| `:` or `/` | Open command palette |
| `q` | Quit (suppressed during any text input) |
| `Ctrl+C` | Hard exit (always works; documented in footer when relevant) |
| `Ctrl+D` / `Ctrl+S` | Submit MultilineInput (“done” / save for multi-line fields) |

**Precedence:** See [README — Key handling precedence](./tui-README.md#key-handling-precedence).

### Concrete `useInput` suppression design

Ink 6's `useInput` fires for **every** keypress on **every** registered handler — there is no built-in priority system. Fighting handlers cause the classic bug where `q` quits inside a text field.

**Required approach:** A **single top-level `useInput` in `App.tsx`** reads `AppState` and routes or suppresses:

```typescript
useInput((input, key) => {
  // 1. Modal / confirm — see "Modal vs global input" below (Ink has no real priority)
  // 2. Text input mode — suppress global shortcuts
  if (state.inTextInput) return; // q, 1–n screen jumps, letter jumps do nothing
  // 3. Async lock — suppress navigation
  if (state.operationInProgress) {
    if (key.escape) dispatch({ type: 'CANCEL_OPERATION' });
    return;
  }
  // 4. Global navigation
  if (input === 'q') { /* quit */ }
  if (/* input is digit 1..SCREEN_ORDER.length */) { /* SET_SCREEN via SCREEN_ORDER */ }
  // ... letter shortcuts
});
```

All other components **MUST NOT** call `useInput` for navigation keys. They may call `useInput` only for keys scoped to their own interaction (e.g. `↑↓` inside a `SelectList`, `Enter` inside a form).

**`inTextInput` update rule:** Every `<TextInput>` and `<MultilineInput>` component **MUST** dispatch `SET_IN_TEXT_INPUT(true)` when it receives focus (`isFocused=true` from `ink-text-input`) and `SET_IN_TEXT_INPUT(false)` when it loses focus. This is the mechanism the global handler uses — it does **not** query Ink's focus internals.

**Per-screen shortcuts** (`a`/`d`/`g`/`p` on Jobs; **`a`/`d`/`s` on Profile**; **`s` on Contact** browse save-all) are handled in screen `useInput`, **only** when `!state.inTextInput && !state.operationInProgress` (unless a screen documents Esc-before-guard for wizards). Global **`s`→settings** is **deferred** on **Profile** and **Contact** content focus (`App.tsx`) so **`s`** means save there. They **MUST** be documented per screen. Conflicts resolved: see [Open questions — resolved](./tui-open-questions.md).

### Modal vs global input (`ConfirmPrompt`)

Ink **dispatches every active `useInput` handler** for each key; there is no built-in capture or bubbling.

- **Implemented:** **Profile unsaved navigate-away** — `App` disables its global `useInput` while `pendingNav !== null`, so **q** / **1–n** / letter jumps do not run during that confirm.
- **Implemented:** Other **`ConfirmPrompt`** instances (default) and error **`SelectList`** menus use **`blockingUiDepth`** — **do not** overload `inTextInput` for this. Profile **navigate-away** confirm uses **`pendingNav`** only (`registerBlocking={false}` on that **`ConfirmPrompt`**).

### Blocking UI and global input

**Normative:** Whenever the user sees a **blocking** confirmation (y/n/Esc), **exclusive** error menu, or other overlay where accidental navigation would lose context or data, global navigation **MUST** be suppressed the same way as **`pendingNav !== null`**.

| User-visible state | Global **q**, **1–n**, letter jumps |
|--------------------|-------------------------------------|
| Profile unsaved navigate-away (`pendingNav`) | Suppressed (today) |
| Any other `ConfirmPrompt` / blocking menu | **MUST** be suppressed via shared mechanism |
| `inTextInput` | Suppressed (today) |
| `operationInProgress` | Suppressed except **Esc** → cancel where wired |

**Store contract (principal developer):** Add **`blockingUiDepth: number`** (or **`blockingUiCount`**) to `AppState`. Increment when opening a blocking confirm/menu, decrement on resolve/unmount. **`App.tsx`** treats **`blockingUiDepth > 0`** like **`pendingNav !== null`** for global shortcut handling. Nested confirms increment depth twice; both must clear on exit.

**Integration options:** (1) **`ConfirmPrompt`** accepts `onOpen` / `onClose` callbacks that dispatch increment/decrement; (2) a tiny **context** provider wraps prompts; (3) screens dispatch manually — **least preferred** (easy to forget). New screens **MUST** use one of the first two patterns when adding confirms.

**Precedence:** Evaluates with **modal / blocking UI** before **text input** in the same tier as [README — Key handling precedence](./tui-README.md#key-handling-precedence).

### Esc double-press during streaming

"First Esc aborts; second Esc navigates back" requires explicit state, not a toggle:

```
streaming → (user presses Esc) → abort-requested [shows "Cancelling…"] → aborted [shows action row: Back / Retry]
```

The `App.tsx` global handler maps Esc to `CANCEL_OPERATION` when an op is running. After cancellation, the screen transitions to `aborted` sub-state. A second Esc (or Esc from `aborted`) navigates back via the normal pop-level logic. **Never implement this as a toggle** — two rapid Esc presses must not navigate back before the abort completes.

### MultilineInput — paste performance

Ink processes input one character at a time via `useInput`. Pasting a large block (e.g. a 3,000-char JD) triggers hundreds of consecutive state updates, causing render thrashing.

**Required:** `<MultilineInput>` **MUST** accumulate input into a `useRef` buffer and **debounce** state updates (e.g. 16ms idle before flushing to `useState`). This is an implementation detail of the component — callers see only the final `onChange(value)` callback. Show character count from the debounced value, not live per-keystroke.

**Layout / UX:** While focused, render a **visible caret** (e.g. inverse block) at the insertion point. Callers **SHOULD** pass **`width`** (`panelInnerWidth(terminalCols)`) and **`height`** (`panelContentViewportRows(terminalRows, reservedForChrome)`) so the field becomes a **virtual viewport**: only that many **wrapped** display rows render; the buffer still holds the full text. New input **tail-follows** (scroll pinned to end); **PgUp** / **PgDn** and **↑** / **↓** scroll the viewport without mutating text. Wrapping uses `linesToWrappedRows` in `src/tui/utils/wrapTextRows.ts` (word wrap + hard break for long tokens). On submit, **cancel** any pending debounced flush before calling `onChange` + `onSubmit`.

### ScrollView — long lines

**Optional `wrapWidth`:** When set, logical `lines` are flattened to wrapped display rows (same helper as `MultilineInput`); `scrollOffset` and `height` apply to those rows. **`displayLines`** bypasses `lines`/`wrapWidth` when the parent already wrapped once (shared with `TextViewport`).

**`padToWidth`:** Rows are padded (or sliced) to that width in JS, then rendered inside a fixed-width column with **`Text wrap="truncate-end"`** so Ink does not re-wrap and spill past the frame (web/terminal layout). **`TextViewport` / `ScrollView`** use **`overflow="hidden"`** so nothing draws past the frame.

**Newlines for wrap:** Use **`splitLinesForWrap`** (or equivalent) before wrapping user/pasted text — **`\\r\\n` / lone `\\r`** must not reach stdout; **`\\r`** resets the cursor to column 0 and makes borders look like they cut through words. **`wrapLineToRows`** also strips **`\\r`** and expands tabs to spaces.

**`TextViewport`:** Single-line dim border with **`panelWidth = panelInnerWidth`** (never wider than the column) + dim status line. Inner content is **`panelWidth − 2`** columns wide (inside the border). Wrapped text uses **`panelFramedTextWidth = panelInnerWidth − 2`** for wrap/pad. **`MultilineInput`** passes **`panelWidth={width + 2}`** when `width` is the framed text width.

**Scroll vs `SelectList`:** When a long text viewport sits above an action `SelectList`, **`↑↓` must move the menu** — use **PgUp/PgDn** (and optional **↑↓** only when no competing list) for the text. Jobs **feedback** and Refine **consultant-view** follow this; JD view and prep summaries use **↑↓** + PgUp/PgDn.

**`wrappedScrollMax`** in `wrapTextRows.ts` keeps scroll bounds consistent with wrapped row counts.

---

## Footer (context-sensitive)

### Footer composition (two-line model)

**UX intent:** Users glance at the footer for **what they can do right now**; it should not duplicate the full shortcut list on every screen.

- **Line 1 (optional, stable):** Baseline hints repeated across many screens — e.g. **`Tab` focus · `?` shortcuts** (when help ships) · **`q` quit** — **MAY** be omitted on very small terminals or when line 2 already states quit.
- **Line 2 (contextual):** **MUST** reflect the **focused** control: list navigation, text submit keys, async cancel, diff review, confirm keys, or error recovery. This is the primary line today; formalizing two lines is **SHOULD** so T1 can evolve `Footer` without breaking every screen at once.

**Principal developer:** Implement as a single **`Footer`** component that accepts **`baselineHint?: string`** and **`contextHint: string`**, concatenating or stacking per terminal height. Screen components pass only **context**; `App` passes **global** fragments when `inTextInput` / `operationInProgress` / `blockingUiDepth` change defaults.

| Mode | Footer content |
|------|----------------|
| Navigation | `↑↓ select · Enter open · Tab focus · 1–n jump · q quit` |
| Single-line input | `Enter: submit · Esc: cancel · q does NOT quit` |
| Multi-line input | Screen `panelFooterHint` (e.g. Jobs: Ctrl+D/Ctrl+S save) **plus** `Text field · q does not quit` when `inTextInput`; inline screen copy repeats submit keys |
| Async running (cancellable) | `⠋ working… · Esc: cancel · navigation locked` |
| Async running (not cancellable) | `⠋ working… · navigation locked (cannot cancel)` |
| Streaming LLM | `streaming… · Esc: abort request · second Esc: back` |
| Diff / bullet review | `↑↓ choose · Enter confirm · Esc: previous sub-state` |
| Confirm prompt | `Enter: yes · n / Esc: no` |
| Error state | `Enter: retry · Esc: back · e: edit inputs` |

---

## Header pipeline strip (contract)

**UX intent:** The header is the **always-visible** orientation cue ([`tui-ux.md` — Wayfinding](./tui-ux.md#wayfinding)).

**SHOULD** include, space permitting:

1. **Product name** (e.g. `Suited`).
2. **Profile identity** — display name from loaded profile, or `(no profile)` / honest empty.
3. **Coarse counts** — e.g. positions / roles when available.
4. **Refined indicator** — e.g. `refined ✓` vs source-only.
5. **Pipeline strip** (target parity with [`tui-ui-mockups.md`](./tui-ui-mockups.md)) — **Source** / **Refined** / **Jobs** / **Last PDF** as compact **on|off** or **●|○** markers derived from the **same** rules as Dashboard pipeline badges.

**Principal developer:** Prefer **one derived object** (e.g. `headerModel` from snapshot + `loadGenerationConfig`) consumed by **`Header`** and tested once, rather than per-screen string assembly. When **`operationInProgress`**, **MAY** append a subtle `…` or spinner token to the header subtitle — **MUST NOT** hide the profile identity entirely.

---

## Screen index

> **Redesign:** See [`dashboard-editor-redesign.md`](./dashboard-editor-redesign.md) for the normative screen structure. Dashboard is a workflow hub, Editor is a new screen, Refine is absorbed into the editor, CurateScreen is superseded.

**`SCREEN_ORDER` (target):** seven screens. Numeric keys **`1`…`n`** map to the array in order.

| # | Screen | Letter | Notes |
|---|--------|--------|-------|
| 1 | Dashboard | `d` | Workflow hub — pipeline status + navigation |
| 2 | Import | `i` | Bring in resume data |
| 3 | Contact | `c` | Contact info fields |
| 4 | Editor | `e` | Edit general resume (NEW — shared `ResumeEditor` component) |
| 5 | Jobs | `j` | Manage jobs; select job → `ResumeEditor` in job mode |
| 6 | Generate | `g` | Produce PDFs |
| 7 | Settings | `s` | API keys, output, defaults |

**Removed:** `refine` (absorbed into editor as contextual actions), `curate` (superseded by Jobs + ResumeEditor).
**Not in SCREEN_ORDER:** `ProfileEditorScreen` — reachable from editor via `:sections` palette command.

---

## Streaming (`callWithToolStreaming`)

**Anthropic:** `claude/client.ts` uses `client.messages.stream()` and yields `text` / `tool_start` / `tool_end` / `done` (no raw partial tool JSON in yields). **OpenRouter:** still yields a single `done` via `callWithTool` until a streaming tool path is implemented there.

Generator signature (already defined; do not redefine):

```typescript
export async function* callWithToolStreaming<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; result: T }
>
```

**Phase B implementation note:** Use `client.messages.stream()` from `@anthropic-ai/sdk`. Listen for `text` deltas and `input_json` events. Emit `tool_start` when the tool use block begins, `tool_end` + parse the accumulated JSON when the block closes, `done` when the full result is validated. Pass `signal` to the SDK's `AbortController` support. Do **not** yield raw partial JSON from the tool input accumulation — hold it until `tool_end`.

`useStreaming` hook accumulates text + tool events. `AbortSignal` from the screen so Esc can cancel.

**Buffer:** See [README — Streaming buffer](./tui-README.md#streaming-buffer-should).

---

## Long-running async

**Implemented:** `useOperationAbort()` in `src/tui/hooks/useOperationAbort.ts` — returns `createController` / `releaseController`. Subscribes to store `operationCancelSeq` (incremented on `CANCEL_OPERATION` / Esc while locked) and aborts the active `AbortController`. Screens pair this with `SET_OPERATION_IN_PROGRESS` and pass `ac.signal` into services (`importProfileFromInput`, `generateRefinementQuestions`, `runTuiGenerateBuildPhase` / `runTuiGenerateRenderPhase`, …).

**Optional future:** a higher-level `useAsyncOp<T>()` that also owns `{ status, result, error }` in local state:

```typescript
function useAsyncOp<T>() {
  // state: { status: 'idle'|'running'|'done'|'error', result: T|null, error: string|null }
  // run(fn, signal?): starts op, sets operationInProgress in global store
  // cancel(): aborts via AbortController if signal was passed
}
```

During `running`: `operationInProgress = true`, sidebar and screen-jump blocked, footer shows spinner + cancel hint if abortable.

---

## Focus & navigation model

`focusTarget` in global state is a **string**, not a fixed enum, so screens can define sub-regions.

| Screen | Tab order |
|--------|-----------|
| Most screens | `sidebar` → `content` → (back to sidebar) |
| Jobs | `sidebar` → `job-list` → `job-detail` → (back) |
| Edit sections | **Refine menu** → `ProfileEditorScreen` → `section-list` → … (sub-levels via Enter/Esc, not Tab) |
| Refine / Generate sub-states | Tab between `prompt`, `input`, `action-row` within the active sub-state |

**Rules:**

- `Tab` advances within the current ordered region list.
- `Esc` pops one level of focus before considering screen navigation: blur input → exit sub-state → (if at top level) prompt quit.
- When `operationInProgress`, screen-jump and sidebar navigation are blocked; scrolling and Esc (for cancel) still work.
- When `inTextInput` is true, `q`, number jumps, and letter shortcuts do nothing (enforced by top-level `useInput` in App.tsx). **Exception:** screens that must still pop on **Esc** (e.g. **Jobs** add-job wizard, **Refine** Q&A / direct edit, **Generate** non-run phases) register a **local** `useInput` that runs **before** their own `inTextInput` guard or that handles **Esc** explicitly while the text component is focused; **Settings** uses first **Esc** from the key field to blur back to the provider list.

---

## Selection caret & inactive menus

Across the shell, **at most one** list-style **caret** (`›`, bright / `white` where supported) **MUST** mark the row that currently receives **↑↓** list navigation. Everything that is not that active list behaves as **parent / background**: **no caret**, rows **dimmed** (including the row that holds contextual selection, e.g. which job is open in a split pane).

**Rules:**

| Area | Caret | Dimming |
|------|-------|---------|
| **Sidebar (removed)** | *N/A — component deleted;* was caret on active row when `focusTarget === 'sidebar'`. | **`DocumentShell`** + palette / TopBar replace sidebar wayfinding. |
| **`SelectList`** | Caret on the selected row **only when `isActive` is true** (this list owns arrow keys). | When **`isActive` is false**, **no** caret on any row; **all** rows dim. Selection index may still update programmatically for when the list becomes active again. |
| **Contact (field list)** | Caret on the focused field label **only when** the panel has content focus **and** phase is **browse** (not while a `TextInput` is focused — avoid two cursors). | When sidebar has focus, or for non-selected fields, dim labels and values accordingly. |
| **Dashboard (main panel)** | No `SelectList` in the panel; no list caret. Use sidebar / number / letter keys. | N/A |

**Not a caret:** Breadcrumb separators (e.g. `Summary › Experience` in Profile) use `›` as typography in **dim** text; they **MUST NOT** be styled as the white list caret.

**Implementation reference:** `DocumentShell.tsx`, `SelectList.tsx`, `ContactScreen.tsx`; split layouts (e.g. Jobs list + detail) rely on **`isActive={false}`** on the non-focused column.

---

## Component hierarchy

> **Target** (after [`dashboard-editor-redesign.md`](./dashboard-editor-redesign.md)):

```
<App>
  {paletteOpen && <CommandPalette … />}
  <ElegantShell>           ← TopBar + ContextBar + main + StatusBar
    <DashboardScreen />        (screen === 'dashboard')  — workflow hub
    <ImportScreen />           (screen === 'import')
    <EditorScreen />           (screen === 'editor')     — wraps <ResumeEditor mode="general" />
    <GenerateScreen />         (screen === 'generate')
    <JobsScreen />             (screen === 'jobs')        — list + <ResumeEditor mode="job" />
    <ProfileEditorScreen />    (screen === 'profile')     — via palette :sections
    <ContactScreen />          (screen === 'contact')
    <SettingsScreen />         (screen === 'settings')
  </ElegantShell>
</App>
```

**`ResumeEditor`** is a shared component (not a screen) used by both `EditorScreen` and `JobsScreen`. It receives context via `ResumeEditorProvider` specifying mode, persistence target, and job metadata.

**No subprocess delegation.** `runTui` renders the app once and awaits exit — no while-loop re-render, no `exitBag`, no `cliArgs.ts` argv-building. Every interaction that was previously delegated to a CLI subcommand (refine, generate, import, profile, contact) **MUST** run as an inline screen component via `src/services/`. `DelegateScreen` does not exist in this architecture.
