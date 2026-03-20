# Phased delivery & current implementation

## North star (Phase C — full coverage)

- **Full service extraction:** Core flows run via **`src/services/`** + domain modules; TUI calls services, not `src/commands/**`.
- **Complete coverage:** Subcommand-equivalent outcomes are available in the TUI; minor CLI-only flags and polish items are listed at the top of [`tui-definition-of-done.md`](./tui-definition-of-done.md) (*post–Phase C polish*).

The baseline requirements — zero breakout, single full-screen Ink interface, no subprocess delegation — apply from Phase A onward. See [Goals & constraints](./tui-goals-and-constraints.md) and [Screen details](./tui-screens.md).

---

## Phase B — services + real screens

- Extract logic from `src/commands/*.ts` into **`src/services/`** (see [Goals & constraints](./tui-goals-and-constraints.md)).
- CLI commands **refactor** to call services; behavior preserved (tests / scripted QA).
- TUI screens call services and shared components (SelectList, DiffView, etc.).
- `callWithToolStreaming` fully wired with `tool_start` / `tool_end` for stable UI.

---

## Phase A — shell

**Purpose:** Shippable navigation shell that renders all eight screens inline within the Ink render tree.

**Required:**

- Ink **Layout**, **Sidebar**, and all **eight screens** rendered as Ink components — no subprocess delegation, no `DelegateScreen` placeholders.
- Screens that are not yet fully functional **MUST** render an inline "not yet implemented" message rather than spawning a subprocess or breaking out to CLI.
- The `runTui` loop / `exitBag` / `cliArgs.ts` subprocess-delegation pattern is **not allowed** at any phase.

**Current repo status (track in PRs; update this line when it changes):**

- **Branch / main:** Phase **C** shipped: Dashboard (health + validation), Settings, Import, Contact, **Jobs** (prepare + **curation preview** + **job-fit feedback** + generate hand-off), **Generate** (progress + done menu), **Refine** (Q&A, polish, direct edit, md sync), **Profile** (editor + dirty nav guard + save error menu). **NavigateProvider** for guarded navigation. Residual polish: see **first section** of [`tui-definition-of-done.md`](./tui-definition-of-done.md). No `DelegateScreen`, `exitBag`, or `cliArgs.ts`.

---

## How to read the rest of the spec

- **[Definition of done](./tui-definition-of-done.md)** — Phase A/B/C checklists (all complete in-repo) plus **post–Phase C** polish notes.
- **[Architecture](./tui-architecture.md)** describes the target; Phase A may omit `store` complexity until needed.
- **[UI mockups](./tui-ui-mockups.md)** show the **target** UI; Phase A may simplify visually but should not contradict [Terminal](./tui-terminal.md) or non-TTY rules.

---

## Agent routing

- **Who works on what in parallel:** [`AGENTS.md`](./AGENTS.md) (workstreams **P0 / S1 / T0–T2 / L1 / Q1** and dependency graph).
- **Single-threaded build order:** [`tui-implementation-order.md`](./tui-implementation-order.md).
- When this doc’s **“current repo status”** line changes, update it in the **same PR** that changes behavior (or a follow-up immediately after).
