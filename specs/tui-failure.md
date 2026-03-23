# Failure, recovery, and resume

- **Error display:** Show what broke (mapped message, not raw stack trace) + action row with Retry / Edit inputs / Back. Never leave the user on a blank or frozen screen after a failure.
- **Idempotent re-runs:** Prefer re-running operations (refine/generate) over inventing resume logic. If intermediate files exist, reflect them on reload.
- **Streaming/tool errors:** Distinguish user-cancelled vs API error vs parse error. Each gets different copy ("Cancelled", "API key invalid — go to Settings", "Unexpected response — retry?").
- **Ctrl+C vs Esc:** Ctrl+C exits the process (documented). Esc aborts in-flight work (request cancel via AbortSignal) without exiting. Second Esc after abort navigates back.

## Save vs disk (document shell)

If the on-disk profile JSON (or job scoped JSON) was **modified externally** after the session loaded it, **save** **SHOULD** detect **mtime** (or equivalent) mismatch and offer **Reload** / **Overwrite** / **Cancel** via a blocking confirm — see [`tui-document-shell.md`](./tui-document-shell.md) §12. **MUST NOT** silently discard newer disk content without user consent.

---

## Recovery vocabulary (normative)

**UX:** Users should **recognize** the same words and outcomes across screens. **Engineering:** Error `SelectList` / action rows **SHOULD** reuse these labels unless a screen needs a narrower meaning.

| Label | Typical meaning | Notes |
|-------|-----------------|-------|
| **Retry** | Re-run the **failed step** with the same inputs (or last good checkpoint) | Resets **streak** counters where applicable ([`tui-open-questions.md`](./tui-open-questions.md)) |
| **Check Settings** | Open **Settings** (often after **3** consecutive failures) | Shown when failure may be key, provider, or path related |
| **Back** / **Dismiss** | Return to a **safe** prior sub-state without quitting the app | **Dismiss** when the error is informational; **Back** when undoing a wizard step |
| **Edit inputs** | Focus or return to the **form** that feeds the failed op | Letter **`e`** where documented in footers |
| **Open Settings** | Same destination as **Check Settings** but for **first-run** / banners | Dashboard `no-api-key`, etc. |

**Blocking errors:** While the error menu is visible, **global quit and screen jumps** are suppressed via **`blockingUiDepth`** ([`tui-architecture.md` — Blocking UI](./tui-architecture.md#blocking-ui-and-global-input)).
