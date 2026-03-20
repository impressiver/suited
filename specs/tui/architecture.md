# Architecture

## Global state (`store.ts`)

`useReducer` + Context. Tracks active screen, loaded profile, focus target, `operationInProgress` (suppresses sidebar/screen-jump during async; content may still scroll), optional `lastError`.

```typescript
interface AppState {
  profileDir: string;
  profile: Profile | null;
  hasRefined: boolean;
  activeScreen: Screen;
  focusTarget: 'sidebar' | 'content' | string; // screens may define sub-regions
  operationInProgress: boolean;
  lastError: string | null;
}

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_PROFILE'; profile: Profile; hasRefined: boolean }
  | { type: 'SET_FOCUS'; target: string }
  | { type: 'SET_OPERATION_IN_PROGRESS'; value: boolean }
  | { type: 'SET_ERROR'; error: string | null };
```

Start simple. Cross-screen state growth is an implementation detail.

**Concurrency:** Only **one** async pipeline at a time **SHOULD** hold `operationInProgress` globally unless explicitly designed otherwise (e.g. background refresh is read-only and does not lock navigation).

---

## Keyboard model

| Key | Behavior |
|-----|----------|
| `Tab` | Advance focus to next region in active screen's Tab order |
| `Shift+Tab` | Previous focus region (implement if Ink allows) |
| `↑↓` | Move selection in focused list or diff block |
| `Enter` | Confirm / activate; submit single-line input |
| `Esc` | Pop one level: blur input → cancel sub-state → go back → (only then) quit prompt |
| `1–8` | Direct screen jump (suppressed when `operationInProgress` or focus is in text input) |
| Letter shortcuts | `g/j/i/d/r/p/c/s` screen jump (same suppression rules) |
| `:` or `/` | Open command palette |
| `q` | Quit (suppressed during any text input, including TextInput, MultilineInput) |
| `Ctrl+C` | Hard exit (always works; documented in footer when relevant) |
| `Ctrl+D` | Submit MultilineInput (the "done" key for multi-line fields) |

**Precedence:** See [README — Key handling precedence](./README.md#key-handling-precedence).

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

Add to `claude/client.ts`. Yields structured events so the UI shows stable progress lines instead of flashing partial JSON:

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

`useStreaming` hook accumulates text + tool events. `AbortSignal` from the screen so Esc can cancel.

**Buffer:** See [README — Streaming buffer](./README.md#streaming-buffer-should).

---

## Long-running async (`useAsyncOp`)

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
- When focus is inside any `<TextInput>` or `<MultilineInput>`, `q`, `1–8`, and letter shortcuts do nothing.

---

## Component hierarchy

```
<App>
  <Layout>
    <Header />           ← "Suited · Jane Smith · 12 positions · refined ✓"
    <Box flexDirection="row">
      <Sidebar />        ← nav items; ► marks active; grayed when operationInProgress
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
