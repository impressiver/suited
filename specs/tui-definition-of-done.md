# Definition of done

## Phase A — MVP (shell + honest UX)

Ship when **all** of the following are true:

- [ ] `suited` with no args in a **non-TTY** does not hang; behavior matches [README — Canonical non-TTY](./tui-README.md#canonical-non-tty-behavior-single-source-of-truth) (stderr message + exit code). Tested by calling the entry with mocked `process.stdin.isTTY = false`.
- [ ] All **eight screens** reachable from sidebar navigation and `1–8` keys; pressing a key navigates without crash.
- [ ] **Dashboard** shows correct state variant (`no-api-key`, `no-source`, `source-only`, `refined`, `ready`) for each real file condition. Verified manually with fixture directories.
- [ ] **Settings** reachable; saves API key to `.env`; masked display confirmed visually.
- [ ] **`q`** does not quit while a `<TextInput>` is focused. Verified by integration test (`inTextInput=true` guard in store). Requires at least one TextInput screen in Phase A — `ContactScreen` satisfies this.
- [ ] **Jobs** renders without visual breakage at terminal width 79 (stacked) and 80+ (two-panel). Verified with `process.stdout.columns` stubbed in an integration test.
- [ ] Errors from async ops show a **mapped message** + at least one recovery action (not a blank or frozen screen).
- [ ] `pnpm test` is green; no pre-existing tests broken by Ink/tsconfig changes.

**Acceptable in Phase A:** subprocess delegation to CLI for heavy flows, **provided** it is documented in [Phased delivery](./tui-phased-delivery.md) and tracked as debt.

---

## Phase B — Services + core flows in Ink

Add to Phase A:

- [ ] **Forbidden-import CI check** passing: no `src/commands/**` or `inquirer` imports under `src/tui/**` (see [Testing](./tui-testing.md#forbidden-imports-ci-enforcement)). **MUST** pass before Phase B is considered done.
- [ ] **Import** completes end-to-end in Ink (URL → scrape → parse → contact form if needed → done). No subprocess.
- [ ] **Refine** fresh Q&A + diff review works in Ink; already-refined sub-menu all six options render (may stub some to "coming soon" for Phase C).
- [ ] **Generate** completes end-to-end in Ink for at least one JD path (paste or saved). No subprocess.
- [ ] `callWithToolStreaming` real implementation: emits `tool_start`/`tool_end` events; no raw partial JSON visible in the streaming pane.
- [ ] `useAsyncOp` + Esc cancel wired for Import (scrape) and at least one Claude call.
- [ ] **Service extraction** done: `src/services/refine.ts`, `improve.ts`, `validate.ts`, `contact.ts` exist with correct signatures per [Goals & constraints](./tui-goals-and-constraints.md); CLI behavior unchanged (scripted QA or tests).

---

## Phase C — Full vision (north star)

Add to Phase B:

- [ ] **Every** subcommand-equivalent action reachable in TUI without subprocess. Permanent exceptions: `--jd` flag (CLI-only), `--all-templates` flag (CLI-only). Document any other permanent exceptions.
- [ ] **Jobs:** add, delete (with `ConfirmPrompt`), generate handoff (`pendingJobId`), prepare (inline curation) — all in-screen per [screens.md](./tui-screens.md#jobsscreen).
- [ ] **Profile editor:** bullet edit, summary edit, bullet reorder — `InlineEditor` only; no `$EDITOR` spawn from TUI.
- [ ] **Refine already-refined:** all options fully implemented, including polish (with `polish-section-select` pre-step), direct edit, prepare.
- [ ] **Generate full pipeline:** JD → analyze → review → curate → preview → polish → consult → trim → PDF → done + tweak option.
- [ ] **`isMdNewerThanJson`** check implemented in RefineScreen mount.
- [ ] **Retry limit:** after 3 consecutive errors from the same operation, Retry is replaced with "Check Settings" (navigates to SettingsScreen). Prevents infinite retry loops against hard failures (bad API key, network unreachable).
- [ ] Errors always show mapped message + Retry/Edit/Back; no frozen UI.
- [ ] Validate and improve surfaced via Dashboard (health score, validation status). No standalone screens needed.

---

## Relationship to phases

| Phase | Doc |
|-------|-----|
| [Phased delivery](./tui-phased-delivery.md) | What A / B / C mean |
| This file | Checklists per phase |
