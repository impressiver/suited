# Failure, recovery, and resume

- **Error display:** Show what broke (mapped message, not raw stack trace) + action row with Retry / Edit inputs / Back. Never leave the user on a blank or frozen screen after a failure.
- **Idempotent re-runs:** Prefer re-running operations (refine/generate) over inventing resume logic. If intermediate files exist, reflect them on reload.
- **Streaming/tool errors:** Distinguish user-cancelled vs API error vs parse error. Each gets different copy ("Cancelled", "API key invalid — go to Settings", "Unexpected response — retry?").
- **Ctrl+C vs Esc:** Ctrl+C exits the process (documented). Esc aborts in-flight work (request cancel via AbortSignal) without exiting. Second Esc after abort navigates back.
