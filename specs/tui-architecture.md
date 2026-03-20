# Architecture

## Global state (`store.ts`)

`useReducer` + Context. Tracks active screen, loaded profile, focus target, `operationInProgress` (suppresses sidebar/screen-jump during async; content may still scroll), optional `lastError`.

```typescript
interface AppState {
  profileDir: string;
  profile: Profile | null;
  hasRefined: boolean;
  activeScreen: Screen;
  focusTarget: string; // 'sidebar' | 'content' | screen-specific sub-region
  inTextInput: boolean; // true when any TextInput/MultilineInput has focus — gates global shortcuts
  operationInProgress: boolean;
  lastError: string | null;
  pendingJobId: string | null; // set by JobsScreen 'g' action; consumed + cleared by GenerateScreen on mount
}

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_PROFILE'; profile: Profile; hasRefined: boolean }
  | { type: 'SET_FOCUS'; target: string }
  | { type: 'SET_IN_TEXT_INPUT'; value: boolean }
  | { type: 'SET_OPERATION_IN_PROGRESS'; value: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_PENDING_JOB'; jobId: string | null };
```

`pendingJobId` solves the Jobs → Generate navigation: `JobsScreen` dispatches `SET_SCREEN + SET_PENDING_JOB`, then `GenerateScreen` reads and clears it on mount.

Start simple. Cross-screen state growth is an implementation detail.

**Concurrency:** Only **one** async pipeline at a time **SHOULD** hold `operationInProgress` globally unless explicitly designed otherwise (e.g. background refresh is read-only and does not lock navigation).

---

## Keyboard model

| Key | Behavior |
|-----|----------|
| `Tab` | Advance focus to next region in active screen's Tab order |
| `Shift+Tab` | Previous focus region. In Ink, detect via raw escape sequence `\x1b[Z` inside `useInput`; terminal support varies — treat as best-effort. |
| `↑↓` | Move selection in focused list or diff block |
| `Enter` | Confirm / activate; submit single-line input |
| `Esc` | Pop one level: blur input → cancel sub-state → go back → (only then) quit prompt |
| `1–8` | Direct screen jump (suppressed when `operationInProgress` or `inTextInput`) |
| Letter shortcuts | `g/j/i/d/r/p/c/s` screen jump (same suppression rules as `1–8`) |
| `:` or `/` | Open command palette |
| `q` | Quit (suppressed during any text input) |
| `Ctrl+C` | Hard exit (always works; documented in footer when relevant) |
| `Ctrl+D` | Submit MultilineInput (the "done" key for multi-line fields) |

**Precedence:** See [README — Key handling precedence](./tui-README.md#key-handling-precedence).

### Concrete `useInput` suppression design

Ink 6's `useInput` fires for **every** keypress on **every** registered handler — there is no built-in priority system. Fighting handlers cause the classic bug where `q` quits inside a text field.

**Required approach:** A **single top-level `useInput` in `App.tsx`** reads `AppState` and routes or suppresses:

```typescript
useInput((input, key) => {
  // 1. Modal / confirm — always wins; handled by ConfirmPrompt's own useInput
  // 2. Text input mode — suppress global shortcuts
  if (state.inTextInput) return; // q, 1-8, letter jumps do nothing
  // 3. Async lock — suppress navigation
  if (state.operationInProgress) {
    if (key.escape) dispatch({ type: 'CANCEL_OPERATION' });
    return;
  }
  // 4. Global navigation
  if (input === 'q') { /* quit */ }
  if (/^[1-8]$/.test(input)) { /* SET_SCREEN */ }
  // ... letter shortcuts
});
```

All other components **MUST NOT** call `useInput` for navigation keys. They may call `useInput` only for keys scoped to their own interaction (e.g. `↑↓` inside a `SelectList`, `Enter` inside a form).

**`inTextInput` update rule:** Every `<TextInput>` and `<MultilineInput>` component **MUST** dispatch `SET_IN_TEXT_INPUT(true)` when it receives focus (`isFocused=true` from `ink-text-input`) and `SET_IN_TEXT_INPUT(false)` when it loses focus. This is the mechanism the global handler uses — it does **not** query Ink's focus internals.

**Per-screen shortcuts** (`a`/`d` on Jobs, `s` for save on Contact/Profile) are handled inside their screen components' `useInput`, **only** when `!state.inTextInput && !state.operationInProgress`. They **MUST** be documented per screen and listed in [Open questions](./tui-open-questions.md) if they risk conflict.

### Esc double-press during streaming

"First Esc aborts; second Esc navigates back" requires explicit state, not a toggle:

```
streaming → (user presses Esc) → abort-requested [shows "Cancelling…"] → aborted [shows action row: Back / Retry]
```

The `App.tsx` global handler maps Esc to `CANCEL_OPERATION` when an op is running. After cancellation, the screen transitions to `aborted` sub-state. A second Esc (or Esc from `aborted`) navigates back via the normal pop-level logic. **Never implement this as a toggle** — two rapid Esc presses must not navigate back before the abort completes.

### MultilineInput — paste performance

Ink processes input one character at a time via `useInput`. Pasting a large block (e.g. a 3,000-char JD) triggers hundreds of consecutive state updates, causing render thrashing.

**Required:** `<MultilineInput>` **MUST** accumulate input into a `useRef` buffer and **debounce** state updates (e.g. 16ms idle before flushing to `useState`). This is an implementation detail of the component — callers see only the final `onChange(value)` callback. Show character count from the debounced value, not live per-keystroke.

---

## Footer (context-sensitive)

| Mode | Footer content |
|------|----------------|
| Navigation | `↑↓ select · Enter open · Tab focus · 1–8 jump · q quit` |
| Single-line input | `Enter: submit · Esc: cancel · q does NOT quit` |
| Multi-line input | `Ctrl+D: done · Enter: newline · Esc: cancel · q does NOT quit` |
| Async running (cancellable) | `⠋ working… · Esc: cancel · navigation locked` |
| Async running (not cancellable) | `⠋ working… · navigation locked (cannot cancel)` |
| Streaming LLM | `streaming… · Esc: abort request · second Esc: back` |
| Diff / bullet review | `↑↓ choose · Enter confirm · Esc: previous sub-state` |
| Confirm prompt | `Enter: yes · n / Esc: no` |
| Error state | `Enter: retry · Esc: back · e: edit inputs` |

---

## Screen index

| Key | Screen |
|-----|--------|
| `1` | Dashboard |
| `2` | Import |
| `3` | Refine |
| `4` | Generate |
| `5` | Jobs |
| `6` | Profile |
| `7` | Contact |
| `8` | Settings |

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

**Implemented:** `useOperationAbort()` in `src/tui/hooks/useOperationAbort.ts` — returns `createController` / `releaseController`. Subscribes to store `operationCancelSeq` (incremented on `CANCEL_OPERATION` / Esc while locked) and aborts the active `AbortController`. Screens pair this with `SET_OPERATION_IN_PROGRESS` and pass `ac.signal` into services (`importProfileFromInput`, `generateRefinementQuestions`, `runTuiGeneratePdf`, …).

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
| Profile | `sidebar` → `section-list` → `editor` → (sub-levels via Enter/Esc, not Tab) |
| Refine / Generate sub-states | Tab between `prompt`, `input`, `action-row` within the active sub-state |

**Rules:**

- `Tab` advances within the current ordered region list.
- `Esc` pops one level of focus before considering screen navigation: blur input → exit sub-state → (if at top level) prompt quit.
- When `operationInProgress`, screen-jump and sidebar navigation are blocked; scrolling and Esc (for cancel) still work.
- When `inTextInput` is true, `q`, `1–8`, and letter shortcuts do nothing (enforced by top-level `useInput` in App.tsx).

---

## Selection caret & inactive menus

Across the shell, **at most one** list-style **caret** (`›`, bright / `white` where supported) **MUST** mark the row that currently receives **↑↓** list navigation. Everything that is not that active list behaves as **parent / background**: **no caret**, rows **dimmed** (including the row that holds contextual selection, e.g. which job is open in a split pane).

**Rules:**

| Area | Caret | Dimming |
|------|-------|---------|
| **`Sidebar`** | **`focusTarget === 'sidebar'`** and row is `activeScreen`: show `›` on that row only. | When focus is **`content`**, **all** sidebar rows dim; **no** caret on any row (current screen is still implied by the header / active route). |
| **`SelectList`** | Caret on the selected row **only when `isActive` is true** (this list owns arrow keys). | When **`isActive` is false**, **no** caret on any row; **all** rows dim. Selection index may still update programmatically for when the list becomes active again. |
| **Contact (field list)** | Caret on the focused field label **only when** the panel has content focus **and** phase is **browse** (not while a `TextInput` is focused — avoid two cursors). | When sidebar has focus, or for non-selected fields, dim labels and values accordingly. |
| **Dashboard quick actions** | `isActive` **MUST** track panel focus (e.g. `focusTarget === 'content'`), not always `true`. | Same as `SelectList` when inactive. |

**Not a caret:** Breadcrumb separators (e.g. `Summary › Experience` in Profile) use `›` as typography in **dim** text; they **MUST NOT** be styled as the white list caret.

**Implementation reference:** `Sidebar.tsx` (takes `focusTarget`), `SelectList.tsx`, `ContactScreen.tsx`, `DashboardScreen.tsx`; split layouts (e.g. Jobs list + detail) rely on **`isActive={false}`** on the non-focused column.

---

## Component hierarchy

```
<App>
  <Layout>
    <Header />           ← "Suited · Jane Smith · 12 positions · refined ✓"
    <Box flexDirection="row">
      <Sidebar />        ← nav items; white › on active row only when sidebar has focus; all dim, no › when content focused
      <ContentArea>      ← flex:1
        <DashboardScreen />      (screen === 'dashboard')
        <ImportScreen />         (screen === 'import')
        <RefineScreen />         (screen === 'refine')
        <GenerateScreen />       (screen === 'generate')
        <JobsScreen />           (screen === 'jobs')
        <ProfileEditorScreen />  (screen === 'profile')
        <ContactScreen />        (screen === 'contact')
        <SettingsScreen />       (screen === 'settings')
      </ContentArea>
    </Box>
    <Footer />           ← context-sensitive copy; see Keyboard/Footer table
  </Layout>
</App>
```

**No subprocess delegation.** `runTui` renders the app once and awaits exit — no while-loop re-render, no `exitBag`, no `cliArgs.ts` argv-building. Every interaction that was previously delegated to a CLI subcommand (refine, generate, import, profile, contact) **MUST** run as an inline screen component via `src/services/`. `DelegateScreen` does not exist in this architecture.
