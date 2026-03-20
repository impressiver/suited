# Stack & repository structure

## Stack

- **Ink 6.8.0**, **React 19.2.4**, **ink-text-input 6.0.0** — all already installed; do **not** re-install or change major versions. See [Build](./tui-build.md) for peer version caveats.
- **TypeScript** ESM, `jsx: react-jsx`.
- **ink-text-input 6.0.0** for focused text fields (already installed).

**Invariant (Phase C):** The TUI is a UI shell over **`src/services/`** and domain modules. See [Phased delivery](./tui-phased-delivery.md) for Phase A allowances.

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
    store.ts                    ← Context + useReducer global state
    hooks/
      useProfile.ts
      useAsyncOp.ts
      useKeymap.ts
      useStreaming.ts
    components/
      layout/
        Header.tsx
        Footer.tsx
        Sidebar.tsx
        ContentArea.tsx
        Layout.tsx
      shared/
        Spinner.tsx
        DiffView.tsx
        ProgressSteps.tsx
        TextInput.tsx
        MultilineInput.tsx
        SelectList.tsx
        CheckboxList.tsx
        ConfirmPrompt.tsx
        StatusBadge.tsx
        ScrollView.tsx
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
| `src/claude/client.ts` | `callWithToolStreaming()` — **stub already exists**; Phase B wires real `client.messages.stream()` |
| `src/commands/refine.ts` | Refactor to `src/services/refine.ts` |
| `src/commands/improve.ts` | Refactor to `src/services/improve.ts` |
| `src/commands/validate.ts` | Refactor to `src/services/validate.ts` |
| `src/commands/contact.ts` | Refactor to `src/services/contact.ts` |

CLI commands remain the non-interactive entry points; refactors **SHOULD** preserve observable CLI behavior (tests / QA).
