# Definition of done

## What's left (post–Phase C polish)

Residual gaps vs an ideal CLI pixel-match (optional follow-ups):

- **Curate screen** — **Task:** Add a **main sidebar** row **Curate**: job list → select job → hub (**Polish sections**, **Professional consultant review**, **Edit profile sections** → `ProfileEditorScreen` with job-scoped store + `profileEditorReturnTo('curate')`, **Direct edit**, **Clear and start over** from global `refined.json` + plan). **Persist** curated profile **per job**; **load by default** when that job is selected again. Spec: [CurateScreen](./tui-screens.md#curatescreen-planned). Optional: **Jobs → prepare-done** action **→ Curate** with pending job id.
- **Suggestion diffs (side-by-side)** — **Task:** Implement **full side-by-side** presentation for reviewing model-suggested changes (two columns: before | after, or an equivalent fixed-width layout), not only today’s unified `DiffView` blocks (`-` / `+` lines). Apply across flows where users accept or reject AI edits: **Refine** diff-review (Q&A apply, polish, direct edit, consultant apply), and **Jobs** job-fit feedback / tailored draft changes where a structured diff is shown. Requirements: remain readable under **`NO_COLOR`** (labels, borders, column headers — not color alone); support **narrow terminals** (graceful fallback to stacked or unified); **scroll** or paging when content exceeds the viewport; reuse or extend `computeRefinementDiff` / `DiffBlock` data where possible rather than ad-hoc strings.
- **Generate** — Pre-flight JD analysis / curation **review checkpoints** before PDF (today: analysis runs inside `runTuiGeneratePdf`). **Token streaming** UI for analyze / curate / polish (step list + spinner today).
- **Refine** — **Per-bullet** inline diff (CLI Inquirer); TUI uses block diff + summary edit. **Streaming panes** for polish / direct-edit (tools run with spinner).
- **Jobs feedback** — CLI `prepare` can **enrich** gaps with Inquirer Q&A before `applyJobFeedback`; TUI applies gap list **without** that interactive enrichment (same `applyJobFeedback` call).
- **Profile** — **Full multi-field** education / certs / projects (degree, dates, etc.) still primary-line focused; parity for power users remains CLI `profile-editor` paths from `refine` if needed.
- **`useAsyncOp`** — Optional unified hook ([architecture](./tui-architecture.md)); `useOperationAbort` + per-screen state is sufficient for shipped flows.

---

## Phase A — MVP (shell + honest UX)

Ship when **all** of the following are true:

- [x] `suited` with no args in a **non-TTY** does not hang; behavior matches [README — Canonical non-TTY](./tui-README.md#canonical-non-tty-behavior-single-source-of-truth) (stderr message + exit code). Covered in `src/commands/flow.test.ts` (stdin non-TTY, stdout non-TTY, both non-TTY).
- [x] All **screens** (including `ProfileEditorScreen`) render as inline Ink components (no `DelegateScreen`, no subprocess). Functional screens are full implementations; none spawn subprocesses for the main flow.
- [x] **Seven** top-level screens reachable from sidebar navigation and **`1–7`** keys; **manual section edit** opens from **Refine** (not a sidebar row). Pressing a key navigates without crash.
- [x] **Dashboard** shows correct state variant (`no-api-key`, `no-source`, `source-only`, `refined`, `ready`) for each real file condition. `getDashboardVariant` unit tests + `fetchProfileSnapshot` **fixture integration** tests under `src/tui/profileSnapshot.integration.test.ts` (temp dirs with `saveSource` / `saveRefined` / `saveJob`).
- [x] **Settings** reachable; saves API key to `.env`; **masked display** — `maskApiKeyForDisplay` in `src/tui/settings/maskApiKey.ts` + `maskApiKey.test.ts` (visual copy still worth a quick manual check).
- [x] **`q`** does not quit while a `<TextInput>` is focused (`inTextInput` guard in `App` + `TextInput` wiring). Automated coverage: store + component tests; manual spot-check on Contact still recommended.
- [x] **Jobs** — list + **Preview** stacked (preview always below list); **80+** cols **detail** view uses list + actions columns (`jobsUseSplitPane` / `jobsListPaneWidth`). `src/tui/jobsLayout.test.ts` + `src/tui/screens/JobsScreen.test.tsx` (mocked `useTerminalSize`).
- [x] Errors from async ops show a **mapped message** + at least one recovery action: Import / Generate / Refine / **Jobs**; **Contact** (load **r** retry); **Profile** (load **r**, save menu + Settings streak); **Dashboard** health (**r**).
- [x] `pnpm test` is green; `pnpm ci` includes build + forbidden-import check for TUI.

**Not acceptable at any phase:** subprocess delegation, `DelegateScreen` placeholders, or `exitBag`/`cliArgs.ts`-style breakout. Every screen renders inline within the Ink tree.

---

## Phase B — Services + core flows in Ink

Add to Phase A:

- [x] **Forbidden-import CI check** passing: `pnpm check:tui-imports` — no `inquirer`, `ora`, or `src/commands/**` imports under `src/tui/**` (see [Testing](./tui-testing.md#forbidden-imports-ci-enforcement)).
- [x] **Import** completes end-to-end in Ink (URL → scrape → parse → contact form if needed → done).
- [x] **Refine** — fresh Q&A + diff review + save in Ink.
- [x] **Generate** — end-to-end in Ink for paste / saved JD / full resume via `runTuiGeneratePdf`.
- [x] `callWithToolStreaming` real implementation for Anthropic (see post–Phase C polish).
- [x] Esc cancel + `AbortSignal` wired for **Refine**, **Import**, **Generate** (`useOperationAbort`, …). Full **`useAsyncOp`** hook remains optional (see above).
- [x] **Service extraction** — `src/services/refine.ts`, `improve.ts`, `validate.ts`, `contact.ts` exist; CLI delegates.

---

## Phase C — Full vision (north star)

Add to Phase B:

- [x] **Subcommand-equivalent actions** in TUI without subprocess. **Permanent CLI-only:** `--jd`, `--all-templates`, and any flag not surfaced in Settings/Generate. **`suited validate`** → Dashboard reference count. **`suited improve`** → Dashboard health + Refine / Profile / Contact. **`suited prepare`** → Jobs: prepare, **view curation** (`formatCurationPreviewLines`), **professional feedback** (`evaluateForJob` / `applyJobFeedback` simplified path).
- [x] **Jobs:** Curation summary after prepare + scrollable preview; view prep + job-fit feedback from job menu when refinement exists (see [tui-screens.md](./tui-screens.md#jobsscreen)).
- [x] **Profile editor:** Structured lists + save; opened from **Refine** (not sidebar); navigate-away guard; save failure **Retry / Settings / Dismiss** (multi-field forms: see post–Phase C polish).
- [x] **Refine** — Already-refined menu: Q&A, **polish** (section presets), **direct edit**; diff save keeps or replaces Q&A session as appropriate. (Jobs / other screens: sidebar only.)
- [x] **Generate** — Progress steps, post-done actions (see post–Phase C for JD checkpoints + streaming).
- [x] **`isMdNewerThanJson`** — Refine banner + confirm.
- [x] **Retry limit** — Refine / Import / Generate / Jobs prepare / **Profile save** (Settings after 3).
- [x] Errors: mapped + recovery on primary async paths (Refine / Import / Generate / Jobs / Profile save).
- [x] **Validate + improve** on Dashboard (health + validation).

---

## Relationship to phases

| Phase | Doc |
|-------|-----|
| [Phased delivery](./tui-phased-delivery.md) | What A / B / C mean |
| This file | Checklists per phase + **post–Phase C polish** |
