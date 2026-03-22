# Specifications

**Implementing (agents or humans):** start with **[`AGENTS.md`](./AGENTS.md)** — workstreams, dependencies, which spec to read per task.

**Product contract (whole repo):** [`project.md`](./project.md)

**TUI (default interactive `suited`):** bookmark [`tui.md`](./tui.md) → index [`tui-README.md`](./tui-README.md) — **Phase C** complete per [`tui-definition-of-done.md`](./tui-definition-of-done.md); optional polish listed there as *post–Phase C*.

User guide and module layout: [`README.md`](../README.md), [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

---

## Router & contract

| File | Role |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | **Parallel workstreams**, dependency graph, PR discipline |
| [`project.md`](./project.md) | Pipeline, accuracy, profile layout, TUI (default) vs CLI subcommands |
| [`tui.md`](./tui.md) | Short bookmark → [`tui-README.md`](./tui-README.md) |

### Pipeline / persistence (planned extensions)

| File | Role |
|------|------|
| [`refinement-history.md`](./refinement-history.md) | Durable snapshots + revert for global **`refined.json`** / **`refined.md`** |

---

## TUI specs (`tui-*.md`)

Grouped for **planning → design → build → verify**. Order within build follows [`tui-implementation-order.md`](./tui-implementation-order.md) unless [`AGENTS.md`](./AGENTS.md) assigns a parallel slice.

### Planning & scope

| File | Role |
|------|------|
| [`tui-phased-delivery.md`](./tui-phased-delivery.md) | Phase A / B / C, delegation vs services |
| [`tui-goals-and-constraints.md`](./tui-goals-and-constraints.md) | Goals, breakout rule, service extraction |
| [`tui-ux.md`](./tui-ux.md) | Pipeline UX, holistic principles (wayfinding, trust, help), discoverability, selection caret / inactive menus |
| [`tui-scope.md`](./tui-scope.md) | LOC / file-count ballpark |
| [`tui-open-questions.md`](./tui-open-questions.md) | Resolved UX/tooling decisions; **Unresolved** section when a choice is still open |

### Design & behavior

| File | Role |
|------|------|
| [`tui-architecture.md`](./tui-architecture.md) | State, keyboard, footer modes, streaming, focus, selection caret rules |
| [`tui-state-machines.md`](./tui-state-machines.md) | Refine / Generate diagrams |
| [`tui-ui-mockups.md`](./tui-ui-mockups.md) | ASCII wireframes |
| [`tui-screens.md`](./tui-screens.md) | Per-screen loads, states, components |
| [`tui-terminal.md`](./tui-terminal.md) | TTY, size, resize, paste |
| [`tui-failure.md`](./tui-failure.md) | Errors, idempotency, Ctrl+C vs Esc |

### Build & stack

| File | Role |
|------|------|
| [`tui-stack-and-structure.md`](./tui-stack-and-structure.md) | Ink/React, directory tree |
| [`tui-build.md`](./tui-build.md) | deps, tsconfig, Vitest glob |
| [`tui-implementation-order.md`](./tui-implementation-order.md) | **Sequential** rollout steps |

### Verify & ship

| File | Role |
|------|------|
| [`tui-testing.md`](./tui-testing.md) | Vitest, ink-testing-library, forbidden imports |
| [`tui-definition-of-done.md`](./tui-definition-of-done.md) | Phases A–C checklists + post–C polish |

### Index (global TUI rules)

[`tui-README.md`](./tui-README.md) — non-TTY SSOT, key precedence, normative MUST NOT, links into the table above.
