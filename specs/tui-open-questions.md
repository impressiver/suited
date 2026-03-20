# Open questions

Historical decisions and **remaining** product choices. Prefer resolving ambiguity in **normative specs** ([`tui-architecture.md`](./tui-architecture.md), [`tui-screens.md`](./tui-screens.md), [`tui-ux.md`](./tui-ux.md)) when behavior is locked.

---

## Unresolved

*None right now.* Add new items here when a spec deliberately leaves a fork (e.g. a new screen or UX experiment).

---

## Resolved

0. **Curate screen — letter shortcut** — **RESOLVED: `u` (unused today).** When **Curate** ships as a sidebar row (after Refine, before Generate per [`tui-screens.md`](./tui-screens.md#curatescreen-planned)), map **`u` → Curate** in `App.tsx` alongside `d i c j r g s`. Update footer hints and [`tui-ux.md`](./tui-ux.md) in the same PR. **`p`** stays non-global (Jobs → prepare).

1. **Multiline submit key** — **RESOLVED: Ctrl+D and Ctrl+S.** Both submit (`MultilineInput`); **F10 is not used** (terminal portability). Documented in [`tui-architecture.md`](./tui-architecture.md) and screen footers.

2. **Stream cancel / Esc** — **RESOLVED (model):** First **Esc** while `operationInProgress` triggers `CANCEL_OPERATION` → `AbortSignal` aborts the in-flight request. There is **no** separate “streaming pane” product yet; footers use **“Esc cancels when supported”** where partial cancellation applies. **Normative** two-phase UX (“abort → then Esc backs out”) is specified in [`tui-architecture.md`](./tui-architecture.md#esc-double-press-during-streaming) for future token-streaming UI; implement as explicit states, not a blind double-Esc toggle.

3. **Profile save discipline** — **RESOLVED: hold-then-confirm-on-navigate.** See [`tui-screens.md`](./tui-screens.md#profileeditorscreen).

4. **Profile breadcrumb** — **RESOLVED: ContentArea.** Section stack breadcrumb (`Summary › Experience › …`) renders **inside** `ProfileEditorScreen`, not in the shell header (header already shows profile meta).

5. **React/Ink peer versions** — **RESOLVED: pinned.** See [`tui-build.md`](./tui-build.md) and [`tui-stack-and-structure.md`](./tui-stack-and-structure.md).

6. **Settings — save on failed probe** — **RESOLVED: block save.** If `probeApiKey` fails, show inline status, **do not** write `.env**. No **“Save anyway”** path in the current TUI (avoids persisting known-bad keys). Optional offline / “write without probe” remains a **future** explicit prompt if needed.

7. **Per-screen letter shortcuts vs text fields vs command palette** — **RESOLVED:** Command palette (`:` / `/`) is **not implemented**; no collision today. Screen shortcuts run in screen-level `useInput` with `!inTextInput && !operationInProgress` where applicable. **When a palette exists,** it **MUST** set a global “palette open” guard so palette keys win; until then, document shortcuts only in screen specs + footers.

8. **`ConfirmPrompt` and global `q` / number jumps** — **RESOLVED (split):**
   - **Profile navigate-away** (unsaved): `App.tsx` sets its global `useInput` **`isActive: pendingNav == null`**, so **q**, **1–n**, and letter jumps do not run while the confirm is visible.
   - **In-screen confirms** (e.g. Jobs delete): **`ConfirmPrompt` does not disable `App`’s handler** — **q** and screen jumps can still fire alongside y/n/Esc. **SHOULD** be unified later via a store flag (e.g. `modalOpen` / `blockingOverlay`) that `App` checks before global nav; **not** by overloading `inTextInput`.

9. **Retry limit reset scope** — **RESOLVED: per-screen React state, per streak variable.** Each screen owns counters (`apiFailureStreak`, `prepareFailStreak`, `saveFailStreak`, …). Counter **increments** on failed API/op; **resets to 0** on success, on **Retry** after failure, on **Dismiss/Back** where implemented, and when navigating to **Settings** from the error menu. **Refine** shares one `apiFailureStreak` across its error surfaces (Q&A, apply, save, polish, etc.). Counters **reset on unmount** (leaving the screen clears state). See [`tui-definition-of-done.md`](./tui-definition-of-done.md) and error rows in [`tui-screens.md`](./tui-screens.md).

10. **`s` vs global `s`→Settings** — **RESOLVED: screen owns `s` for save on Profile and Contact.** In `App.tsx`, defer global **`s` → Settings** when **`focusTarget === 'content'`** and `!inTextInput` on **`profile`** (with **`a`/`d`** for list ops) and **`contact`** (browse-mode save). **`SelectList` does not use letter search**; no conflict with row labels. On **Settings**, **`s`** is save and the global map targets `settings` only when changing screens, so no conflict.

**`$EDITOR` in TUI (non-question, decision recorded):** The TUI does **not** spawn `$EDITOR`. Inline `InlineEditor` / lists only; CLI `suited refine --edit` for external editor.
