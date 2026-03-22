# Testing

Same runner as the rest of the repo: **Vitest** (`pnpm test`), `environment: 'node'`.

## Tooling

| Piece | Action |
|--------|--------|
| Vitest include | `['src/**/*.test.ts', 'src/**/*.test.tsx']` |
| Testing library | `@inkjs/testing-library` (Ink 5+). See [Build](./tui-build.md) for version caveats. |
| React/Ink | Pin to same version in production; avoid duplicate React via `pnpm` deduplication. |
| Fake timers | Use `vi.useFakeTimers()` for spinner/debounce assertions; reset in `afterEach`. |

## Dependency injection design

Integration tests **MUST NOT** hit the network or mutate `output/`. All service dependencies are injected via **React context** defined in `src/tui/services-context.tsx`:

```typescript
// src/tui/services-context.tsx
export interface TuiServices {
  loadSource: typeof import('../profile/serializer').loadSource;
  loadRefined: typeof import('../profile/serializer').loadRefined;
  saveRefined: typeof import('../profile/serializer').saveRefined;
  scrapeLinkedInProfile: typeof import('../ingestion/linkedin-scraper').scrapeLinkedInProfile;
  generateRefinementQuestions: typeof import('../services/refine').generateRefinementQuestions;
  applyRefinements: typeof import('../services/refine').applyRefinements;
  curateForJob: typeof import('../generate/curator').curateForJob;
  // ... all other functions with network/FS side effects
}

export const ServicesContext = createContext<TuiServices>(defaultServices);
export const useServices = () => useContext(ServicesContext);
```

- **Production:** `<App>` wraps children with `<ServicesContext.Provider value={defaultServices}>` where `defaultServices` imports the real implementations.
- **Tests:** Wrap the component under test with `<ServicesContext.Provider value={mockServices}>` where each mock returns canned responses.

Screen components call `const { loadSource, curateForJob, ... } = useServices()` instead of importing functions directly.

## Where tests live

Colocated with the code under test:

```
src/
  services/
    refine.test.ts          ← pure service function contracts (mock callWithTool)
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
      MultilineInput.test.tsx  ← debounce behavior; paste accumulation
    App.integration.test.tsx
```

## Unit tests (no terminal UI)

| Area | What to assert |
|------|----------------|
| `store` reducer | All transitions; `pendingJobId` set/clear; `inTextInput` set/clear; invalid combos impossible by type |
| Keymap / input mode | `q` and screen-jump number keys suppressed when `inTextInput=true`; fire when `inTextInput=false` |
| `useOperationAbort` / `throwIfAborted` | `operationCancelSeq` bumps abort active controller; `throwIfAborted` throws `AbortError` when aborted |
| `useAsyncOp` (future) | `run()` → running; success clears error; AbortSignal cancels; concurrent `run()` rejected (document chosen behavior) |
| `DiffView` helpers | Given old/new pairs → required `-`/`+` prefixes; blocks have boundaries; accessible without color |
| `MultilineInput` | Input accumulated into ref; state update fires after debounce interval, not per-keystroke |
| Service functions | Pure logic contracts; inject mock `callWithTool`; assert return types |
| Pipeline / suggested-next | No source → Import; no refined → Refine; no API key → Settings; pure functions |

## Integration tests (Ink)

| Flow | Steps | Pass criteria |
|------|--------|----------------|
| Screen jump | Render Dashboard; press `8` | Frame contains Settings title |
| Tab focus | Tab twice | Focus indicator advances (sidebar → content) |
| Quit | Press `q` from navigation (`inTextInput=false`) | App exits cleanly |
| `operationInProgress` guard | Dispatch running op; press `3` | Screen does NOT change |
| Input suppression | Mount `<MultilineInput>`; focus; press `q` | App still mounted; `inTextInput=true` in store |
| Already-refined sub-menu | Navigate to Refine with refined profile stub | Sub-menu renders; no Inquirer output in `lastFrame()` |
| Error + retry | Stub scraper to throw; Import; submit | Error state renders; Retry re-runs op |
| Profile snapshot fixtures | Temp dir + `saveSource` / `saveRefined` / `saveJob` | `fetchProfileSnapshot` + `getDashboardVariant` match expected states |
| Jobs width | Mock `useTerminalSize` 79 vs 100 | `JobsScreen` output includes `Preview` only at 80+ cols |
| `pendingJobId` navigation | Dispatch `SET_PENDING_JOB('job-1')` + `SET_SCREEN('generate')` | GenerateScreen skips JD picker; `pendingJobId` cleared |
| Esc double-press (streaming) | Start streaming op; press Esc once | `aborted` sub-state shown; press Esc again → back |

### Streaming tests

Streaming states are tested with a **fake async generator** injected via `ServicesContext`:

```typescript
const fakeStream = async function* () {
  yield { type: 'text', text: 'Analyzing...' };
  yield { type: 'tool_start', name: 'curate' };
  yield { type: 'tool_end', name: 'curate' };
  yield { type: 'done', result: mockCurationPlan };
};
```

Use `vi.useFakeTimers()` to control async advancement. Assert that:
- `tool_start` event shows a stable "Calling tool…" line (not raw JSON)
- `tool_end` event clears that line and resumes text
- `done` transitions the screen to the next state

## Forbidden imports (CI enforcement)

**MUST** implement before Phase B ships (aligns with Phase B DoD checklist):

- **Option A (preferred):** Biome custom rule or `no-restricted-imports` equivalent: files under `src/tui/**` **MUST NOT** import `inquirer`, `ora`, or any path matching `src/commands/**`.
- **Option B (fallback):** Shell script in `pnpm test` or a `pnpm ci:lint-imports` script: `grep -r "from.*commands/"` under `src/tui/`; fail if matches found.

**Rationale:** "No breakout" is not enforceable by human review alone. This check prevents Phase A subprocess debt from silently persisting into Phase B.

## Resume templates (lint enforcement)

**`pnpm lint`** runs Biome, then **`scripts/check-templates-no-em-dash.mjs`**, which walks **`src/templates/**`** and fails if any file contains:

- the **em dash** character (U+2014), or
- HTML entities that render as an em dash: `&mdash;`, `&#8212;`, `&#x2014;`

**Rationale:** Keep template source ASCII-friendly and avoid typographic dashes in shipped Eta/CSS that are easy to break when editing or diffing.

**Generated resume HTML/PDF:** `renderResumeHtml()` runs `sanitizeResumeDocument()` so resolved `ResumeDocument` strings passed into Eta cannot contain U+2014/U+2013 (or common em-dash entities) even if profile or model output slipped them in. Consultant tool output is normalized the same way for evaluations and follow-up questions (`src/utils/noEmDash.ts`).

## CI

One `pnpm test` covers everything. TUI tests run headless — the testing library does not require a real TTY. If `@inkjs/testing-library` requires a specific env flag, document it in `package.json` `scripts.test` or a `.env.test` file.
