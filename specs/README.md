# Specifications

**Implementing (agents or humans):** start with **[`AGENTS.md`](./AGENTS.md)** — workstreams, dependencies, which spec to read per task.

**Product contract (whole repo):** [`project.md`](./project.md)

**TUI (Ink replacement for dashboard):** stub [`tui.md`](./tui.md) → index [`tui-README.md`](./tui-README.md)

User guide and module layout: [`README.md`](../README.md), [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

---

## Router & contract

| File | Role |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | **Parallel workstreams**, dependency graph, PR discipline |
| [`project.md`](./project.md) | Pipeline, accuracy, profile layout, UI split (CLI vs future TUI) |
| [`tui.md`](./tui.md) | Short bookmark → [`tui-README.md`](./tui-README.md) |

---

## TUI specs (`tui-*.md`)

Grouped for **planning → design → build → verify**. Order within build follows [`tui-implementation-order.md`](./tui-implementation-order.md) unless [`AGENTS.md`](./AGENTS.md) assigns a parallel slice.

### Planning & scope

| File | Role |
|------|------|
| [`tui-phased-delivery.md`](./tui-phased-delivery.md) | Phase A / B / C, delegation vs services |
| [`tui-goals-and-constraints.md`](./tui-goals-and-constraints.md) | Goals, breakout rule, service extraction |
| [`tui-ux.md`](./tui-ux.md) | Pipeline UX, discoverability |
| [`tui-scope.md`](./tui-scope.md) | LOC / file-count ballpark |
| [`tui-open-questions.md`](./tui-open-questions.md) | Decisions to lock |

### Design & behavior

| File | Role |
|------|------|
| [`tui-architecture.md`](./tui-architecture.md) | State, keyboard, footer modes, streaming, focus |
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
| [`tui-definition-of-done.md`](./tui-definition-of-done.md) | MVP vs full vision checklists |

### Index (global TUI rules)

[`tui-README.md`](./tui-README.md) — non-TTY SSOT, key precedence, normative MUST NOT, links into the table above.
