# Open questions

Lock these before wide implementation to reduce screen churn.

**Resolved questions are listed at the bottom.** Unresolved questions are active decisions needed before implementing the affected screen.

---

## Unresolved

1. **Multiline submit key:** Ctrl+D only, or also F10? Pick one primary, document it everywhere.
2. **Stream cancel:** First Esc aborts in-flight request; second Esc navigates back (recommended). Confirm and document in footer.
4. **Profile breadcrumb:** In Header, or inside ContentArea? (Recommend: ContentArea — Header already has profile info.)
6. **Settings — save on failed probe:** If API key validation fails, block save vs allow "Save anyway" with warning — pick one.
7. **Per-screen letter shortcuts vs text fields:** When Jobs uses `a`/`d`/`g`/`p`, confirm no conflict with command palette or search — document resolution.
8. **`ConfirmPrompt` and `q`/nav suppression:** When `<ConfirmPrompt>` overlays a screen (e.g. unsaved-changes on navigate-away), should it also set `inTextInput = true` to suppress `q` and `1–8` keys? Or use a separate `modalOpen` flag? Decide one approach and apply consistently.
9. **Retry limit reset scope:** The Phase C retry limit (3 consecutive errors → replace Retry with "Check Settings") — does the counter reset per-screen, per-operation-type, or per-session? Define clearly before implementing.
10. **`s`-key conflict in ProfileEditorScreen:** The save shortcut `s` in ProfileEditorScreen conflicts with letter navigation if a SelectList is focused and the user types `s`. Resolve: either use a different save key (e.g. Ctrl+S), or confirm that `s` only fires when `inTextInput = false` and no SelectList item starts with `s`.

---

## Resolved

3. **Profile save discipline** — **RESOLVED: hold-then-confirm-on-navigate.** Changes are held in local component state until `s` (save). On navigate-away with unsaved changes, a `<ConfirmPrompt>` overlays: "Unsaved changes — save before leaving? (Enter=save / n=discard / Esc=stay)". Applied consistently in ProfileEditorScreen and ContactScreen. See [screens.md](./tui-screens.md#profileeditorscreen).

5. **React/Ink peer versions** — **RESOLVED: already pinned.** Ink 6.8.0, React 19.2.4, ink-text-input 6.0.0 are in `package.json` and locked in the lockfile. Do not re-install or change major versions. See [Build](./tui-build.md) and [Stack](./tui-stack-and-structure.md).

**`$EDITOR` in TUI (non-question, decision recorded):** The TUI does **not** spawn `$EDITOR` for any flow. Profile editing is entirely inline via `InlineEditor`. Users who want to open markdown in their editor use `suited refine --edit` (CLI only). This is consistent with the breakout rule.
