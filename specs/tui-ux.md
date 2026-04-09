# UX & workflow

**Target shell:** **[`tui-document-shell.md`](./tui-document-shell.md)** — **Dashboard** as workflow hub, shared **ResumeEditor** component for both general and job-specific editing, **TopBar** (screen + **Job:**), **StatusBar** (glyphs + pipeline), **`:`** palette, **Ctrl-?** help. See **[`dashboard-editor-redesign.md`](./dashboard-editor-redesign.md)** for the normative redesign.

The CLI mental model is **Import → Edit resume (with contextual refine tools) → (optional per-job editing) → Generate**. The **Dashboard** is a workflow hub showing pipeline status and navigation. **Refine** is not a separate screen — polish, consultant, Q&A, sniff, and direct edit are contextual actions within the **Editor** and **Jobs** screens.

- **Pipeline status** — compact **graphical** segments on **StatusBar right** and **Dashboard** pipeline summary.
- **Suggested next step** — **Dashboard** highlights the next action based on pipeline state. Empty state when no source → Import CTA.
- **First-run / blocked** — No API key → StatusBar / modal path to Settings; no source → Import CTA. Non-LLM actions MUST work without a key.

**Discoverability:** **`:`** palette + **Ctrl-?** (fallbacks `?`, `h`, Help item) + outline/jump; **MUST NOT** rely only on Tab through every section. **`1–n`** number keys map to `SCREEN_ORDER`. **Manual profile sections:** scoped **Edit** from editor palette (`:sections`); save respects **active session** target.

**Contextual chrome:** **Single-line StatusBar** — left = alerts/ops, right = pipeline/health; **no** two-line footer cheat sheet. Deep overlay footers MAY add one line for that flow only.

```mermaid
flowchart LR
  subgraph inputs [Inputs]
    LI[LinkedIn / source]
    JD[Job descriptions]
  end
  LI --> Import[Import]
  Import --> Editor[Editor — general resume]
  JD --> Jobs[Jobs]
  Editor --> Gen[Generate]
  Jobs -->|select job → editor| JobEditor[Editor — job-specific]
  JobEditor --> Gen
  Gen --> Out[PDFs / artifacts]
```

**Refine tools** (polish, consultant, Q&A, sniff, direct edit) are contextual actions available in both the general **Editor** and job-specific editing within **Jobs**. They are not a separate screen.

**Per-job iteration:** Selecting a job in **Jobs** opens the same `ResumeEditor` component with job context and a collapsible JD pane. Same editing UX, different persistence target.

Users may open palette / overlays anytime; **Dashboard** is the default hub.

**Generate — template vs flair:** **Template** picks the **baseline layout**; **flair** (level) is a **separate** control on how much **creative freedom** the layout/design agent may use when rendering that baseline (more flair → more **variety** and **artistic license** in the visual result). Defaults in Settings apply only to the initial flair level, not to template choice.

**Onboarding flow:** On first entry to the Editor with source but no refined data, the user is guided through Q&A → polish → consultant → sniff in sequence. Each step can be accepted, discarded, or skipped. After onboarding, each tool is available individually via keybinds/palette. See [`dashboard-editor-redesign.md` §7](./dashboard-editor-redesign.md#7-onboarding-flow-first-refinement).

---

## Selection caret (visual focus)

The UI **MUST** present **at most one** bright list caret (`›`) at a time: the row that **currently** receives list arrow keys. When focus is on the **main panel**, the **sidebar** is treated as background — **fully dimmed, no caret**. When focus is on the **sidebar**, panel lists are **inactive**: **no caret**, all rows dim (e.g. `SelectList` with `isActive={false}`). The Dashboard main panel has **no** in-panel action list (navigation is the sidebar). **Split panes** (e.g. Jobs job list beside detail): only the pane that owns **↑↓** shows the caret; the other pane stays dim without `›`. **Contact** browse mode shows the caret on the field label only with panel focus; in **edit** mode the caret is suppressed so the text field cursor is the sole insertion indicator.

Normative detail and tables: [Architecture — Selection caret & inactive menus](./tui-architecture.md#selection-caret--inactive-menus).

---

## Holistic design principles

This section records a **joint UX / engineering review** of the shell: what “good” looks like for users, and what the codebase should guarantee so behavior stays consistent as screens grow.

### Wayfinding

- **Screen + job context:** **TopBar** shows **screen** + **Job:** line only. **StatusBar right** carries pipeline/health glyphs. Profile directory **MAY** appear in palette “About / status” or Settings — not required on TopBar.
- **Breadcrumbs inside deep editors:** Unchanged — stay inside overlay ([resolved](./tui-open-questions.md#resolved)).
- **Suggested next step:** **Palette** Dashboard entry + empty states; avoid duplicating long coaching on StatusBar.

**Implementation alignment:** StatusBar / palette **SHOULD** consume the **same derived signals** as `getDashboardVariant` / snapshot loaders so pipeline dots do not drift.

### Trust and predictability

- **No surprise exits:** While any **blocking** confirm or error menu is visible, **q** and **screen jumps** **MUST NOT** fire ([Architecture — Blocking UI](./tui-architecture.md#blocking-ui-and-global-input)). This matches user expectation from CLI modals and avoids data loss on muscle memory.
- **Cancel vs quit:** **Esc** backs out or cancels work **in-process**; **Ctrl+C** exits the app ([`tui-failure.md`](./tui-failure.md)). Footers **SHOULD** repeat that distinction wherever streaming or long jobs run.
- **Settings honesty:** After saving `.env`, remind that **keys apply on next launch** (already normative on Settings); **SHOULD** show a **one-line success state** so users know persistence succeeded before restart.

### Discoverability (shortcuts without memorization)

- **Footer as coach:** The bottom line is the **primary** teaching surface for **this panel’s** keys. **SHOULD** follow a stable pattern: action keys first, then navigation, then quit ([`tui-architecture.md` — Footer composition](./tui-architecture.md#footer-composition-two-line-model)).
- **Letter and number jumps:** The global map (**`d i c j r g s`**, **`1–n`**) is powerful but opaque. **SHOULD** add an in-app **shortcut help** overlay (**`?`**) listing jumps, **q**, **Tab**, and “sidebar vs content focus” — toggled from `App.tsx`, suppressed while `inTextInput` or `operationInProgress` unless the overlay owns input.
- **Command palette (`:` / `/`):** Remains the **north star** for power users; when implemented, it **MUST** register a **palette-open** guard ahead of global navigation ([resolved](./tui-open-questions.md#resolved)). Until then, **`?`** help is the lightweight substitute.

### Progressive disclosure

- **One primary action per blocked state:** e.g. no API key → one clear path to Settings; no source → one path to Import. Secondary actions via sidebar only.
- **Wizard depth:** Add-job, Refine sub-flows, and Generate steps **SHOULD** show **where they are in the flow** (title + optional step index) so users can predict how many **Esc** presses return to the list.

### Cross-screen vocabulary

- **Recovery actions:** Prefer the same **labels** and **keys** across screens where behavior matches: **Retry**, **Check Settings** (after repeated failures), **Back** / **Dismiss**, **Edit inputs** ([`tui-failure.md`](./tui-failure.md)). Reduces re-learning when moving between Import, Generate, Jobs, and Refine.

### Narrow terminals and `NO_COLOR`

- **Layout:** Split panes and side-by-side diffs **MUST** degrade gracefully (stacked layout, unified diff) per existing mockup notes.
- **Meaning:** Do not rely on **color alone** for success vs error; use **prefix characters** (`!`, `✓` where encoding allows) or **dim vs bright** text. Aligns with side-by-side diff polish in [`tui-definition-of-done.md`](./tui-definition-of-done.md).
