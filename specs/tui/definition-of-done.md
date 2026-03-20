# Definition of done

## Phase A — MVP (shell + honest UX)

Ship when **all** of the following are true:

- [ ] `suited` with no args in a **non-TTY** does not hang; behavior matches [README — Canonical non-TTY](./README.md#canonical-non-tty-behavior-single-source-of-truth) (stderr + exit code).
- [ ] All **eight screens** reachable from the TUI (navigation shell).
- [ ] **Dashboard** shows pipeline-style status and suggested next step where data exists.
- [ ] **Settings** reachable; API key / env story **documented** (masked display, save path).
- [ ] `q` / **Ctrl+C** documented; **no accidental quit** while in text input (when text inputs exist).
- [ ] **Jobs** two-panel or stacked at &lt;80 cols **does not** break layout semantics.
- [ ] Errors show a **mapped message** + recovery path when async work fails (no blank screen).

**Acceptable in Phase A:** subprocess delegation to CLI for heavy flows, **provided** it is documented in [Phased delivery](./phased-delivery.md) and tracked as debt.

---

## Phase B — Services + core flows in Ink

Add to Phase A:

- [ ] **No** `run*` imports from `src/commands/` in `src/tui/**` (enforce via [CI](./testing.md#forbidden-imports-ci-enforcement)).
- [ ] **Import** completes end-to-end in Ink (URL → scrape → parse → contact if needed → done).
- [ ] **Refine** completes fresh Q&A + diff review in Ink; **already-refined** sub-menu works.
- [ ] **Generate** completes end-to-end in Ink for at least one JD path.
- [ ] `callWithToolStreaming` emits `tool_start`/`tool_end`; no raw JSON flash in the streaming pane.
- [ ] `useAsyncOp` + **Esc** cancel wired where the underlying API supports `AbortSignal`.

---

## Phase C — Full vision (north star)

Add to Phase B:

- [ ] **Every** subcommand-equivalent action reachable in TUI **without** subprocess (except where explicitly allowed forever, if any).
- [ ] **Jobs:** add, delete (confirm), generate handoff, prepare — all in-screen per [screens.md](./screens.md#jobsscreen).
- [ ] **Profile editor:** bullet edit, summary edit, reorder — **InlineEditor** only; no `$EDITOR` from TUI.
- [ ] **Refine** already-refined sub-menu: **all** options (consultant, polish, rerun, direct edit, prepare) match CLI capabilities.
- [ ] **Generate** full pipeline: JD → analyze → curate → polish → consult → PDF → done.
- [ ] Errors always show **Retry / Edit / Back**; never frozen UI.

---

## Relationship to phases

| Phase | Doc |
|-------|-----|
| [Phased delivery](./phased-delivery.md) | What A / B / C mean |
| This file | Checklists per phase |
