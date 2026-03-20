# Testing

Same runner as the rest of the repo: **Vitest** (`pnpm test`), `environment: 'node'`.

## Tooling

| Piece | Action |
|--------|--------|
| Vitest include | `['src/**/*.test.ts', 'src/**/*.test.tsx']` |
| `ink-testing-library` | Add as dev dep when first Ink integration test lands |
| React/Ink | Pin to same version in production; avoid duplicate React via pnpm deduplication |

## Where tests live

Colocated with the code under test:

```
src/
  services/
    refine.test.ts
    validate.test.ts
  tui/
    store.test.ts
    hooks/
      useKeymap.test.ts
      useAsyncOp.test.ts
    components/shared/
      SelectList.test.tsx
      DiffView.test.tsx
      ConfirmPrompt.test.tsx
    App.integration.test.tsx
```

## Unit tests (no terminal UI)

| Area | What to assert |
|------|----------------|
| `store` reducer | All transitions; invalid combos impossible by type |
| Keymap / input mode | `q` and `1–8` suppressed during text input; active during navigation |
| `useAsyncOp` | `run()` → running; success clears error; concurrent run rejected |
| `DiffView` helpers | Given old/new pairs → required `-`/`+` prefixes; accessible without color |
| Service functions | Pure logic contracts; mock Claude client |
| Pipeline / suggested-next | No source → Import; no refined → Refine; pure functions |

## Integration tests (Ink)

| Flow | Steps | Pass criteria |
|------|--------|----------------|
| Screen jump | Render Dashboard; press `8` | Frame contains Settings title |
| Tab focus | Tab twice | Focus indicator advances (sidebar → content) |
| Quit | Press `q` from navigation | App exits cleanly |
| `operationInProgress` guard | Dispatch running op; press `3` | Screen does NOT change |
| Input suppression | Focus `<MultilineInput>`; press `q` | App still mounted |
| Already-refined sub-menu | Navigate to Refine with refined profile | Sub-menu renders; no Inquirer breakout |
| Error + retry | Stub scraper to throw; Import; submit | Error screen shows; Retry restarts op |

Stub Claude, scraper, and file writes via context/DI; tests never hit the network or mutate `output/`.

## CI

One `pnpm test` covers everything. TUI tests run headless — `ink-testing-library` does not require a real TTY.

---

## Forbidden imports (CI enforcement)

**SHOULD** implement at least one of:

- **Biome / ESLint** rule: files under `src/tui/**` **MUST NOT** import:
  - `inquirer`
  - `ora` (unless explicitly whitelisted for a non-UI utility — default: forbid)
  - Any path **`src/commands/**`** (use `src/services/**` after extraction)
- **Script** in `pnpm test` or `pnpm ci`: `rg` / `git grep` guard that fails if `src/tui` imports `commands/` or `inquirer`.

**Rationale:** "No breakout" is not enforceable by human review alone at scale.
