# Definition of done

## What's left (backlog toward Phase C)

Single list of gaps vs [Screen details](./tui-screens.md) and [Goals & constraints](./tui-goals-and-constraints.md). Update this section when behavior lands.

### Infrastructure / cross-cutting

- [x] **`callWithToolStreaming`** — Anthropic: real `messages.stream()`; yields `text` / `tool_start` / `tool_end` / `done`; optional `AbortSignal`. OpenRouter: still delegates to `callWithTool` (single `done`) until a streaming tool path exists.
- [ ] **`useAsyncOp` + `AbortSignal`** — **`useOperationAbort`** + `operationCancelSeq` on **Refine**, **Import**, **Generate** — **done** for those flows. Shared **`useAsyncOp`** hook from [architecture](./tui-architecture.md) remains optional. Still open: Jobs prepare LLM, Profile long saves, mid–single-call cancel inside long single Claude requests beyond existing client `signal`.
- [ ] **Retry limit** — **Refine**, **Import**, **Generate**: **Check Settings** after **3** failures — **done**. Still open: Jobs, Profile, global policy.
- [ ] **Errors** — **Refine**, **Import**, **Generate**: mapped message + recovery — **done** for primary async paths. Still open: Jobs, Profile polish, Contact edge cases.

### Refine

- [x] **`isMdNewerThanJson`** on mount — banner + `ConfirmPrompt` → `markdownToProfile()` + `saveRefined()` when user confirms (see [screens](./tui-screens.md#refinescreen); implemented in `RefineScreen`).
- [ ] **Already-refined sub-menu (full)** — today: new Q&A pass + “stay”. Still missing per spec: consultant review, polish (+ section/position pickers), direct edit (`MultilineInput` → `applyDirectEdit`), prepare for saved job (job picker + curation), streaming panes where applicable.
- [ ] **Diff review** — per-block / full **edit-inline** still open. **Done in TUI:** `SelectList` (accept / **edit proposed summary** / discard) + `diff-edit-summary` → recomputed diff.

### Profile editor

- [x] **Sections — Education, Certifications, Projects** — list + **a** / **d** / **`[`** / **`]`** reorder + Enter → inline edit of **primary line** (institution / cert name / project title). Full multi-field forms (degree, dates, etc.) still CLI / future work.
- [x] **Skills** — list with **a**/**d**, reorder **`[`**/**`]`**, Enter → inline name edit (not the spec’s `CheckboxList` toggle UX; functional parity for editing the skill list).
- [x] **Bullets** — reorder via **`[` / `]`** (swap with previous/next); `↑↓` is selection via `SelectList` (spec [ProfileEditorScreen](./tui-screens.md#profileeditorscreen)).
- [x] **Bullets** — add (`a`) and delete (`d`, `ConfirmPrompt`) on the experience bullet list; `App` defers `a`/`d` so `d` does not jump to Dashboard.
- [x] **Experience — position list** — **a** add (placeholder title/company/start month), **d** delete + confirm, **`[`** / **`]`** reorder, Enter → bullets.
- [ ] **Navigate-away confirm** — when dirty, intercept sidebar / `1–8` / screen-cycle (not only in-screen Esc stack); policy in [open questions](./tui-open-questions.md).

### Generate

- [ ] **Full pipeline UX** — per [GenerateScreen](./tui-screens.md#generatescreen): JD analysis review, curation preview + manual bullet pick, step indicators, consulting output, **done** action row (regenerate, change template/flair, different job, tweak, back), optional tweak-only path.
- [ ] **Streaming** — show streaming for analyze / curate / polish / consult where the CLI does. *(Generate pipeline still uses spinners; `callWithToolStreaming` available for future UI.)*

### Jobs

- [ ] **Prepare** — inline curation + summary as in spec (current implementation may be partial vs [JobsScreen](./tui-screens.md#jobsscreen)).
- [ ] **Layout polish** — two-panel vs stacked at width 80+ where spec still differs from implementation.

### Dashboard / product

- [ ] **Validate / improve** — surfaced via Dashboard (health, validation status) per Phase C; no requirement for standalone commands screens if spec stays satisfied.

---

## Phase A — MVP (shell + honest UX)

Ship when **all** of the following are true:

- [x] `suited` with no args in a **non-TTY** does not hang; behavior matches [README — Canonical non-TTY](./tui-README.md#canonical-non-tty-behavior-single-source-of-truth) (stderr message + exit code). Covered in `src/commands/flow.test.ts` (stdin non-TTY, stdout non-TTY, both non-TTY).
- [x] All **eight screens** render as inline Ink components (no `DelegateScreen`, no subprocess). Functional screens are full implementations; none spawn subprocesses for the main flow.
- [x] All **eight screens** reachable from sidebar navigation and `1–8` keys; pressing a key navigates without crash.
- [x] **Dashboard** shows correct state variant (`no-api-key`, `no-source`, `source-only`, `refined`, `ready`) for each real file condition. `getDashboardVariant` unit tests + `fetchProfileSnapshot` **fixture integration** tests under `src/tui/profileSnapshot.integration.test.ts` (temp dirs with `saveSource` / `saveRefined` / `saveJob`).
- [x] **Settings** reachable; saves API key to `.env`; **masked display** — `maskApiKeyForDisplay` in `src/tui/settings/maskApiKey.ts` + `maskApiKey.test.ts` (visual copy still worth a quick manual check).
- [x] **`q`** does not quit while a `<TextInput>` is focused (`inTextInput` guard in `App` + `TextInput` wiring). Automated coverage: store + component tests; manual spot-check on Contact still recommended.
- [x] **Jobs** — stacked list below **80** cols; **80+** uses list + **Preview** column (`jobsUseSplitPane` / `jobsListPaneWidth`). `src/tui/jobsLayout.test.ts` + `src/tui/screens/JobsScreen.test.tsx` (mocked `useTerminalSize`).
- [x] Errors from async ops show a **mapped message** + at least one recovery action: Import / Generate / Refine / **Jobs** (Retry prepare, Settings after streak, Back); **Contact** (load **r** retry, save hint); **Profile** (**r** retry); **Dashboard** health load failure (**r** refresh snapshot).
- [x] `pnpm test` is green; `pnpm ci` includes build + forbidden-import check for TUI.

**Not acceptable at any phase:** subprocess delegation, `DelegateScreen` placeholders, or `exitBag`/`cliArgs.ts`-style breakout. Every screen renders inline within the Ink tree.

---

## Phase B — Services + core flows in Ink

Add to Phase A:

- [x] **Forbidden-import CI check** passing: `pnpm check:tui-imports` — no `inquirer`, `ora`, or `src/commands/**` imports under `src/tui/**` (see [Testing](./tui-testing.md#forbidden-imports-ci-enforcement)).
- [x] **Import** completes end-to-end in Ink (URL → scrape → parse → contact form if needed → done).
- [x] **Refine** — fresh Q&A + diff review + save in Ink (see backlog above for full parity with already-refined menu and external MD).
- [x] **Generate** — end-to-end in Ink for paste / saved JD / full resume via `runTuiGeneratePdf` (see backlog for full pipeline UX).
- [x] `callWithToolStreaming` real implementation for Anthropic (see backlog).
- [x] Esc cancel + `AbortSignal` wired for **Refine**, **Import**, **Generate** (`useOperationAbort`, `importProfileFromInput` / `scrapeLinkedInProfile` / `parseLinkedInPaste`, `runTuiGeneratePdf`). Full **`useAsyncOp`** hook remains optional (see backlog).
- [x] **Service extraction** — `src/services/refine.ts`, `improve.ts`, `validate.ts`, `contact.ts` exist; CLI delegates.

---

## Phase C — Full vision (north star)

Add to Phase B:

- [ ] **Every** subcommand-equivalent action reachable in TUI without subprocess. Permanent exceptions: `--jd` flag (CLI-only), `--all-templates` flag (CLI-only). Document any other permanent exceptions.
- [ ] **Jobs:** full parity with [JobsScreen](./tui-screens.md#jobsscreen) where backlog still lists gaps.
- [ ] **Profile editor:** full parity with [ProfileEditorScreen](./tui-screens.md#profileeditorscreen) (see backlog).
- [ ] **Refine** — full parity with [RefineScreen](./tui-screens.md#refinescreen) (see backlog).
- [ ] **Generate** — full pipeline (see backlog).
- [x] **`isMdNewerThanJson`** — done in Refine (see backlog for other Refine gaps).
- [ ] **Retry limit** — extend “Check Settings after 3” to Jobs / Profile / global policy (Refine / Import / Generate done).
- [ ] Errors always show mapped message + Retry/Edit/Back; no frozen UI. *(Refine / Import / Generate primary paths done.)*
- [ ] Validate and improve surfaced via Dashboard (health score, validation status). No standalone screens needed.

---

## Relationship to phases

| Phase | Doc |
|-------|-----|
| [Phased delivery](./tui-phased-delivery.md) | What A / B / C mean |
| This file | Checklists per phase + **What's left** backlog |
