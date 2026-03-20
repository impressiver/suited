# TUI specification (index)

These documents are the **product + engineering contract** for the full-screen Ink TUI that replaces `runDashboard` when users run `suited` with no subcommand in a real TTY. They are split so **vision**, **phasing**, and **checklists** stay navigable.

**Bookmark:** [`specs/tui.md`](./tui.md) remains a one-line pointer to this README.

**Related:** [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

---

## Documents

| Doc | Purpose |
|-----|---------|
| [Phased delivery & current implementation](./tui-phased-delivery.md) | **Start here:** Phase A/B/C, what the repo does today vs north star |
| [Goals & constraints](./tui-goals-and-constraints.md) | Goals, non-goals, breakout rule, service extraction, rollback |
| [UX & workflow](./tui-ux.md) | Pipeline, discoverability, mermaid pipeline diagram |
| [Stack & structure](./tui-stack-and-structure.md) | Ink/React versions, directory tree, modified files |
| [Architecture](./tui-architecture.md) | State, keyboard, footer modes, streaming, focus, components, key precedence |
| [State machines](./tui-state-machines.md) | Mermaid diagrams for Refine / Generate |
| [UI mockups](./tui-ui-mockups.md) | ASCII wireframes (~80 cols) |
| [Terminal & environment](./tui-terminal.md) | TTY gate (**canonical non-TTY**), size, resize, paste, logging |
| [Failure & recovery](./tui-failure.md) | Errors, idempotency, Ctrl+C vs Esc |
| [Testing](./tui-testing.md) | Vitest, ink-testing-library, forbidden-import enforcement |
| [Screen details](./tui-screens.md) | Per-screen loads, states, components (Settings API probe semantics) |
| [Build](./tui-build.md) | deps, tsconfig, Vitest glob |
| [Implementation order](./tui-implementation-order.md) | Phased rollout steps |
| [Definition of done](./tui-definition-of-done.md) | **MVP** vs **full vision** checklists |
| [Open questions](./tui-open-questions.md) | Decisions to lock |
| [Scope estimate](./tui-scope.md) | File counts, LOC ballpark |

---

## Normative language

In this spec, **MUST** / **MUST NOT** / **SHOULD** / **MAY** follow [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119) usage:

- **MUST NOT:** TUI code under `src/tui/**` imports `inquirer`, `ora`, or `src/commands/**` (enforce in CI; see [Testing](./tui-testing.md)).
- **SHOULD:** Service extraction keeps CLI behavior identical; use tests or scripted QA before merge.

---

## Canonical non-TTY behavior (single source of truth)

When `stdin` or `stdout` is **not** a TTY and the user runs `suited` with **no subcommand**:

1. The process **MUST NOT** block waiting for interactive input.
2. The process **MUST** print a **one-line** message to **stderr** explaining that an interactive terminal is required (or pointing to `suited --help` / example subcommands).
3. Exit code **SHOULD** be **0** (non-error “not interactive”) unless the project standardizes on non-zero — document the chosen code in `src/commands/flow.ts` and keep this doc aligned.

**Implementation note:** Entry is `runFlow()` from [`src/commands/flow.ts`](../src/commands/flow.ts) (invoked by the default Commander action in `src/index.ts`). Do not duplicate this behavior in multiple places.

---

## Key handling precedence

When multiple handlers could apply, order is:

1. **Modal / confirm** (blocking prompt)
2. **Text / multiline input** (suppress global `q`, `1–8`, letter jumps)
3. **Async / streaming** (Esc → cancel if `AbortSignal` wired; navigation locked if `operationInProgress`)
4. **Global navigation** (sidebar, screen jumps, `q`)

Per-screen shortcuts (e.g. `a`/`d` on Jobs) **MUST** be documented per screen and **SHOULD NOT** fire when a text field has focus; resolve conflicts in [Open questions](./tui-open-questions.md) during implementation.

---

## Streaming buffer (SHOULD)

For LLM streaming UI, **SHOULD** cap retained text in memory (e.g. last **256 KiB** or **2 000** lines, whichever is smaller) with a clear “… earlier output truncated …” line to avoid unbounded growth on long streams.

---

## Telemetry

**Default:** no analytics or phone-home from the TUI. If that ever changes, it MUST be opt-in and documented in `SECURITY.md`.
