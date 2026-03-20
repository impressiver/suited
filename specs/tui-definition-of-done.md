# Definition of done

## What's left (backlog toward Phase C)

Single list of gaps vs [Screen details](./tui-screens.md) and [Goals & constraints](./tui-goals-and-constraints.md). Update this section when behavior lands.

### Infrastructure / cross-cutting

- [ ] **`callWithToolStreaming`** — real `client.messages.stream()` implementation; `tool_start` / `tool_end` / `done`; no raw partial JSON in the UI (see [implementation order](./tui-implementation-order.md) §12).
- [ ] **`useAsyncOp` + `AbortSignal`** — Esc cancels long-running work everywhere it applies; not only Import scrape.
- [ ] **Retry limit** — after 3 consecutive failures from the same operation, offer **Check Settings** (navigate to Settings) instead of infinite Retry.
- [ ] **Errors** — always mapped message + Retry / Edit / Back (or equivalent); no frozen UI; audit screens for gaps.

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
- [ ] **Streaming** — show streaming for analyze / curate / polish / consult where the CLI does.

### Jobs

- [ ] **Prepare** — inline curation + summary as in spec (current implementation may be partial vs [JobsScreen](./tui-screens.md#jobsscreen)).
- [ ] **Layout polish** — two-panel vs stacked at width 80+ where spec still differs from implementation.

### Dashboard / product

- [ ] **Validate / improve** — surfaced via Dashboard (health, validation status) per Phase C; no requirement for standalone commands screens if spec stays satisfied.

---

## Phase A — MVP (shell + honest UX)

Ship when **all** of the following are true:

- [ ] `suited` with no args in a **non-TTY** does not hang; behavior matches [README — Canonical non-TTY](./tui-README.md#canonical-non-tty-behavior-single-source-of-truth) (stderr message + exit code). Tested by calling the entry with mocked `process.stdin.isTTY = false`.
- [x] All **eight screens** render as inline Ink components (no `DelegateScreen`, no subprocess). Functional screens are full implementations; none spawn subprocesses for the main flow.
- [x] All **eight screens** reachable from sidebar navigation and `1–8` keys; pressing a key navigates without crash.
- [ ] **Dashboard** shows correct state variant (`no-api-key`, `no-source`, `source-only`, `refined`, `ready`) for each real file condition. Verified manually with fixture directories.
- [ ] **Settings** reachable; saves API key to `.env`; masked display confirmed visually.
- [x] **`q`** does not quit while a `<TextInput>` is focused (`inTextInput` guard in `App` + `TextInput` wiring). Automated coverage: store + component tests; manual spot-check on Contact still recommended.
- [ ] **Jobs** renders without visual breakage at terminal width 79 (stacked) and 80+ (two-panel). Verified with `process.stdout.columns` stubbed in an integration test.
- [ ] Errors from async ops show a **mapped message** + at least one recovery action (not a blank or frozen screen).
- [x] `pnpm test` is green; `pnpm ci` includes build + forbidden-import check for TUI.

**Not acceptable at any phase:** subprocess delegation, `DelegateScreen` placeholders, or `exitBag`/`cliArgs.ts`-style breakout. Every screen renders inline within the Ink tree.

---

## Phase B — Services + core flows in Ink

Add to Phase A:

- [x] **Forbidden-import CI check** passing: `pnpm check:tui-imports` — no `inquirer`, `ora`, or `src/commands/**` imports under `src/tui/**` (see [Testing](./tui-testing.md#forbidden-imports-ci-enforcement)).
- [x] **Import** completes end-to-end in Ink (URL → scrape → parse → contact form if needed → done).
- [x] **Refine** — fresh Q&A + diff review + save in Ink (see backlog above for full parity with already-refined menu and external MD).
- [x] **Generate** — end-to-end in Ink for paste / saved JD / full resume via `runTuiGeneratePdf` (see backlog for full pipeline UX).
- [ ] `callWithToolStreaming` real implementation (see backlog).
- [ ] `useAsyncOp` + Esc cancel wired broadly (Import scrape is the primary example; extend per backlog).
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
- [ ] **Retry limit** (see backlog).
- [ ] Errors always show mapped message + Retry/Edit/Back; no frozen UI.
- [ ] Validate and improve surfaced via Dashboard (health score, validation status). No standalone screens needed.

---

## Relationship to phases

| Phase | Doc |
|-------|-----|
| [Phased delivery](./tui-phased-delivery.md) | What A / B / C mean |
| This file | Checklists per phase + **What's left** backlog |
