# TUI specification (index)

These documents are the **product + engineering contract** for the full-screen **Ink** TUI — the **default** when users run `suited` with no subcommand in a real TTY (`runFlow` → `runTui`). They are split so **vision**, **phasing**, and **checklists** stay navigable. **Phase C** is marked complete in [`tui-definition-of-done.md`](./tui-definition-of-done.md); residual items are *post–Phase C polish*.

**Implementers:** **[`AGENTS.md`](./AGENTS.md)** assigns **parallel workstreams** (P0, S1, T0–T2, L1, Q1), dependencies, and PR discipline — read that before splitting work across people.

**Bookmark:** [`specs/tui.md`](./tui.md) remains a one-line pointer to this README.

**Related:** [`specs/project.md`](./project.md) (whole product), [`specs/README.md`](./README.md) (grouped file list), [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)

---

## Documents

The same files are **grouped by phase** in [`specs/README.md`](./README.md). Use this table for **what each doc answers**.

| Doc | Purpose |
|-----|---------|
| [Phased delivery & current implementation](./tui-phased-delivery.md) | Phase A/B/C status, what shipped vs optional follow-ups |
| [Goals & constraints](./tui-goals-and-constraints.md) | Goals, non-goals, breakout rule, service extraction, rollback |
| [UX & workflow](./tui-ux.md) | Pipeline, holistic principles (wayfinding, trust, help), discoverability, single caret / dim inactive menus, mermaid pipeline diagram |
| [Stack & structure](./tui-stack-and-structure.md) | Ink/React versions, directory tree, modified files |
| [Architecture](./tui-architecture.md) | State, keyboard, footer modes, streaming, focus, components, key precedence |
| [State machines](./tui-state-machines.md) | Mermaid diagrams for Refine / Generate |
| [UI mockups](./tui-ui-mockups.md) | ASCII wireframes (~80 cols) |
| [Terminal & environment](./tui-terminal.md) | TTY gate (**canonical non-TTY**), size, resize, paste, logging |
| [Failure & recovery](./tui-failure.md) | Errors, idempotency, Ctrl+C vs Esc |
| [Testing](./tui-testing.md) | Vitest, ink-testing-library, forbidden-import enforcement |
| [Screen details](./tui-screens.md) | Per-screen loads, states, components (Settings API probe semantics) |
| [Build](./tui-build.md) | deps, tsconfig, Vitest glob |
| [Implementation order](./tui-implementation-order.md) | **Sequential** rollout steps (single implementer); parallel lanes → [`AGENTS.md`](./AGENTS.md) |
| [Definition of done](./tui-definition-of-done.md) | Phases A–C + **post–Phase C** polish list |
| [Open questions](./tui-open-questions.md) | Resolved decisions archive; empty **Unresolved** until a new fork |
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

1. **Blocking UI** — any **modal / confirm** or overlay that **MUST** capture keys before global quit (see [`tui-architecture.md` — Blocking UI](./tui-architecture.md#blocking-ui-and-global-input); includes **`pendingNav`** for Profile navigate-away and **`blockingUiDepth > 0`** for **`ConfirmPrompt`** + error **`SelectList`** menus)
2. **Text / multiline input** (suppress global `q`, screen-jump number keys, letter jumps)
3. **Async / streaming** (Esc → cancel if `AbortSignal` wired; navigation locked if `operationInProgress`)
4. **Global navigation** (sidebar, screen jumps, `q`)
5. **Command palette** (`:` / `/`) when implemented — **MUST** sit ahead of global navigation while open (see [Open questions — resolved](./tui-open-questions.md))

Per-screen shortcuts (e.g. `a`/`d` on Jobs) **MUST** be documented per screen and **SHOULD NOT** fire when a text field has focus. Conflict resolutions: [Open questions — resolved](./tui-open-questions.md).

---

## Streaming buffer (SHOULD)

For LLM streaming UI, **SHOULD** cap retained text in memory (e.g. last **256 KiB** or **2 000** lines, whichever is smaller) with a clear “… earlier output truncated …” line to avoid unbounded growth on long streams.

---

## Telemetry

**Default:** no analytics or phone-home from the TUI. If that ever changes, it MUST be opt-in and documented in `SECURITY.md`.
