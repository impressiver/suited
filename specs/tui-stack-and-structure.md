# Stack & repository structure

## Stack

- **Ink 6.8.0**, **React 19.2.4**, **ink-text-input 6.0.0** — all already installed; do **not** re-install or change major versions. See [Build](./tui-build.md) for peer version caveats.
- **TypeScript** ESM, `jsx: react-jsx`.
- **ink-text-input 6.0.0** for focused text fields (already installed).

**Invariant:** The TUI is a single full-screen Ink application. Every screen renders inline within the Ink render tree. Subprocess delegation (`DelegateScreen`, `exitBag`, `cliArgs.ts`) is not permitted at any phase. Unimplemented screens show an inline stub, never a subprocess. See [Phased delivery](./tui-phased-delivery.md).

---

## Directory structure (target)

```
src/
  services/
    refine.ts
    improve.ts
    validate.ts
    contact.ts
  tui/
    index.tsx                   ← Ink app root; exports runTui()
    App.tsx                     ← Screen router, global keybindings
    store.tsx                   ← Context + useReducer global state
    fetchProfileSnapshot.ts     ← disk → ProfileSnapshot (shared with useProfileSnapshot; fixture-tested)
    jobsLayout.ts               ← Jobs split/stack column threshold (80)
    panelContentWidth.ts        ← panelInnerWidth, panelContentViewportRows
    utils/wrapTextRows.ts       ← word-wrap to display rows; ScrollView + MultilineInput
    hooks/
      useProfile.ts
      useOperationAbort.ts   ← Esc ↔ AbortController (see tui-architecture.md)
      useKeymap.ts
      useStreaming.ts
    isUserAbort.ts             ← shared user-cancel detection (Import / Refine / Generate errors)
    components/
      layout/
        Header.tsx
        Footer.tsx
        Sidebar.tsx
        ContentArea.tsx
        Layout.tsx
      shared/                 ← barrel `index.ts`; Spinner, SelectList, TextInput, …
        Spinner.tsx
        DiffView.tsx
        ProgressSteps.tsx
        TextInput.tsx
        MultilineInput.tsx
        SelectList.tsx
        CheckboxList.tsx       (Generate section pick; Refine polish scope when wired)
        ConfirmPrompt.tsx
        StatusBadge.tsx
        ScrollView.tsx
        TextViewport.tsx
        InlineEditor.tsx
    screens/
      DashboardScreen.tsx
      ImportScreen.tsx
      RefineScreen.tsx
      GenerateScreen.tsx
      JobsScreen.tsx
      ProfileEditorScreen.tsx
      ContactScreen.tsx
      SettingsScreen.tsx
```

---

## Modified files (outside `src/tui/`)

| File | Change |
|------|--------|
| `src/index.ts` | Default action invokes `runFlow()` (TTY vs non-TTY); keep in sync with [README](./tui-README.md#canonical-non-tty-behavior-single-source-of-truth) |
| `src/commands/flow.ts` | **New file.** **`runTui()`** dynamic import when interactive; **one-line stderr + exit** when not (canonical behavior) |
| `src/claude/client.ts` | `callWithToolStreaming()` — Anthropic streaming + tool events; OpenRouter falls back to `callWithTool` |
| `src/utils/abort.ts` | `throwIfAborted(signal)` for cooperative cancel in scraper / generate pipeline |
| `src/commands/refine.ts` | Refactor to `src/services/refine.ts` |
| `src/commands/improve.ts` | Refactor to `src/services/improve.ts` |
| `src/commands/validate.ts` | Refactor to `src/services/validate.ts` |
| `src/commands/contact.ts` | Refactor to `src/services/contact.ts` |

CLI commands remain the non-interactive entry points; refactors **SHOULD** preserve observable CLI behavior (tests / QA).
