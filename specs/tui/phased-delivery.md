# Phased delivery & current implementation

## North star (Phase C — full vision)

- **Zero breakout:** After the TUI mounts, the user never sees raw Inquirer, chalk banners, or unstructured `console.log` from command code. All interaction stays in the Ink tree.
- **No subprocess** for core flows: Import, Refine, Generate, Jobs, Profile, Contact run via **`src/services/`** + domain modules, not `spawn(suited …)`.
- **Complete coverage:** Every flow available via subcommands is available in the TUI with equivalent outcomes.

See [Goals & constraints](./goals-and-constraints.md) and [Screen details](./screens.md).

---

## Phase B — services + real screens

- Extract logic from `src/commands/*.ts` into **`src/services/`** (see [Goals & constraints](./goals-and-constraints.md)).
- CLI commands **refactor** to call services; behavior preserved (tests / scripted QA).
- TUI screens call services and shared components (SelectList, DiffView, etc.).
- `callWithToolStreaming` fully wired with `tool_start` / `tool_end` for stable UI.

---

## Phase A — shell (may ship first)

**Purpose:** Shippable navigation shell without rewriting every command.

**Allowed (interim):**

- Ink **Layout**, **Sidebar**, eight **screen placeholders** or read-only views.
- **Subprocess** or CLI delegation **MAY** be used **only** where documented, to avoid blocking on full service extraction — but **MUST** be listed in PRs and removed by Phase B for those flows.

**Current repo status (track in PRs; update this line when it changes):**

- **Branch / main:** Ink TUI with global navigation, Dashboard/Jobs/Settings-style data, **delegate** flows that run `node <argv[1]> <subcommand> …` with stdio inherited, then return to the TUI.
- This is **Phase A** behavior, **not** Phase C. Treat subprocess delegation as **technical debt** toward Phase B/C.

---

## How to read the rest of the spec

- **[Definition of done](./definition-of-done.md)** splits **MVP (Phase A/B)** from **full vision (Phase C)**.
- **[Architecture](./architecture.md)** describes the target; Phase A may omit `store` complexity until needed.
- **[UI mockups](./ui-mockups.md)** show the **target** UI; Phase A may simplify visually but should not contradict [Terminal](./terminal.md) or non-TTY rules.
