# Screen details

Every screen documents: what loads on mount, the full state machine (every state the screen can be in), and which shared components handle each state. **No state may delegate to CLI or Inquirer** (Phase C). See [Phased delivery](./tui-phased-delivery.md).

### DashboardScreen

**Loads on mount:** `loadSource()`, `loadRefined()`, `loadGenerationConfig()`. Detects API key presence from `process.env`.

**First-run / missing directory:** If `profileDir` does not exist or `loadSource()` returns `null` (file not found — serializer **MUST** return `null`, not throw, for missing files), show `no-source` state. Do not throw or crash. The TUI is responsible for creating `profileDir` before the first write (mkdir -p semantics, delegated to whichever service performs the first write).

**States:**
- `no-api-key` — banner + Settings shortcut; all other actions disabled
- `no-source` — "Suggested next: Import" + Import shortcut
- `source-only` — suggest Refine; show import stats
- `refined` — suggest Generate or manage jobs; show health score from `computeHealthScore()`
- `ready` — has jobs + refined; suggest Generate; show last PDF details

**Components:** `StatusBadge` (pipeline), `SelectList` (quick actions), `ScrollView` (recent activity).

### ImportScreen

**Loads on mount:** check if source exists (pre-fill "re-import" mode).

**States:**
- `idle` — show input field + headed checkbox
- `detecting` — `useAsyncOp` running `detectInput()`
- `scraping` — `useAsyncOp` running `scrapeLinkedInProfile()` with `AbortSignal`; `ProgressSteps` at step 2/4
- `parsing-export` — running `parseLinkedInExport()`
- `parsing-paste` — multiline input → calling `parseLinkedInPaste()` via Claude
- `normalizing` — running `normalizeProfile()`
- `contact-prompt` — if contact fields missing: inline form (not a CLI prompt); Tab between fields; Enter/s to save
- `done` — success summary: name, N positions, N skills; action row (→ Refine, → Dashboard)
- `error` — error message + Retry / Edit URL / Back

**Components:** `TextInput`, `ProgressSteps`, `Spinner`, `MultilineInput` (for paste mode), `StatusBadge`, `ConfirmPrompt` (for re-import).

### RefineScreen

**Loads on mount:** `loadRefined()`. If refined, start at `already-refined`; else start at `not-refined`.

**External edit detection (`isMdNewerThanJson`):** The CLI checks whether `refined.md` has been externally edited (newer mtime than `refined.json`) and prompts sync. The TUI **MUST** replicate this check on mount. If `refined.md` is newer, show an inline banner inside the `already-refined` sub-menu: "Your `refined.md` was edited outside the TUI. Sync changes now?" with `<ConfirmPrompt>` → on yes, call `markdownToProfile()` + `saveRefined()`. This **must not** silently drop the external edits.

**States:**
```
not-refined:
  → generating-questions      (spinner; calls generateRefinementQuestions)
  → qa-phase                  (TextInput per question; questions[index] rendered inline)
  → generating-refinements    (spinner; calls applyRefinements with answers)
  → diff-review               (DiffView per block; accept / edit-inline / discard)
  → saving                    (spinner; calls saveRefined)
  → consultant-running        (streaming; calls evaluateProfileForJob)
  → consultant-done           (action row: Generate / Back)
  → error                     (error + retry)
  → cancelled                 (Retry / Back; distinct from error)

already-refined:
  → sub-menu (SelectList):
      "Run consultant review"      → consultant-running → consultant-done
      "Polish bullets (AI)"        → polish-section-select → polish-running → diff-review
      "Rerun Q&A from scratch"     → generating-questions (same flow as not-refined)
      "Apply direct edit"          → direct-edit-input → direct-edit-running → diff-review
      "Prepare for a saved job"    → job-picker → curation-running → curation-summary
```

**Key constraint:** Every sub-state renders inside `<RefineScreen>`. No sub-state spawns an Inquirer prompt or calls `runRefine`.

**Direct edit sub-flow:** `MultilineInput` → on submit, calls `applyDirectEdit(profile, instructions)` via `callWithToolStreaming` → shows streaming output → transitions to `diff-review` with the resulting changes.

**Polish sub-flow:** `polish-section-select` renders a `CheckboxList` of sections (Experience, Skills, etc.) and optionally a `SelectList` of positions to narrow scope. Only after the user confirms does the screen call `polishProfile(profile, { sections, positionIds })`. This mirrors the existing CLI's interactive section/position prompts — the TUI replaces those prompts with the CheckboxList step.

**Prepare sub-flow:** `SelectList` of saved jobs → on select, calls `curateForJob()` with streaming → shows `ProgressSteps` → shows curation summary → action row (accept + save, rerun, back).

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `DiffView`, `InlineEditor`, `Spinner`, `ProgressSteps`, `ScrollView` (streaming output), `ConfirmPrompt`.

### GenerateScreen

**Loads on mount:** `loadRefined()` or `loadSource()`, `loadJobs()`, `loadGenerationConfig()` (pre-populate last template/flair). If `pendingJobId` is set in `AppState`, dispatch `SET_PENDING_JOB(null)` to clear it and skip the JD source picker, jumping directly to `jd-confirmed` with the pre-selected job.

**States:**
```
idle:
  → jd-source-picker      (SelectList: paste / use saved / no JD)
  → jd-paste              (MultilineInput; Ctrl+D submits)
  → jd-saved-picker       (SelectList of saved jobs)
  → jd-confirmed          (show job title/company; go to config)

config:
  → template-picker       (SelectList of 5 templates)
  → flair-picker          (← → keys; integrated with template selection)

pipeline (all cancellable via Esc + AbortSignal):
  → analyzing-jd          (step 1/6; spinner + streaming)
  → jd-analysis-review    (show analysis: industry, seniority, key skills; confirm or re-analyze)
  → curating              (step 2/6; spinner + streaming)
  → curation-preview      (show selected positions/bullets; continue / rerun / manual edit)
  → curation-manual-edit  (CheckboxList for manual section/bullet selection; done → curation-preview)
  → polishing             (step 3/6; spinner + streaming)
  → consulting            (step 4/6; spinner + streaming; show consultant output)
  → trimming              (step 5/6; spinner)
  → exporting-pdf         (step 6/6; spinner)
  → done                  (show path + fit%; action row — see below)
  → error                 (error + retry same step or restart)
  → cancelled             (Retry / Back to config; distinct from error)
```

**Generate `done` action row:** The existing CLI offers more post-generation options than a simple back. The TUI **MUST** include:
- Generate another (same job, same template/flair)
- Change template / flair (same JD — go back to `template-picker`)
- Generate for a different job (go back to `jd-source-picker`)
- Tweak content (`MultilineInput` → `tweak-running` → re-runs trim + PDF only; maps to `tweakResumeContent()`)
- Back to Dashboard

**`--jd` flag / `--all-templates`:** CLI-only. Not replicated in TUI. See [Goals & constraints](./tui-goals-and-constraints.md#coverage-validate-improve-prepare---jd-flag).

**Components:** `SelectList`, `MultilineInput`, `ProgressSteps`, `Spinner`, `ScrollView` (streaming), `CheckboxList` (curation manual edit), `StatusBadge`.

### JobsScreen

**Loads on mount:** `loadJobs()`.

**States:**
- `list` — two-panel or stacked; job list left, detail right; active job highlighted
- `add-title` — TextInput for job title
- `add-company` — TextInput for company
- `add-jd` — MultilineInput for JD paste; Ctrl+D submits; calls `saveJob()`
- `delete-confirm` — `ConfirmPrompt` inline
- `view-jd` — `ScrollView` of full JD text; Esc to close
- `generate-navigate` — dispatches `SET_SCREEN('generate')` + `SET_PENDING_JOB(jobId)` simultaneously; GenerateScreen reads and clears `pendingJobId` on mount to pre-populate the JD source picker
- `prepare-curating` — inline curation spinner + streaming for the selected job
- `prepare-done` — summary; action row (→ Generate, → back)
- `error` — error + retry / back

**All actions stay inside the TUI.** `g` dispatches `SET_SCREEN + SET_PENDING_JOB`; `p` runs the curation pipeline inline.

**Per-screen shortcuts active only in `list` state:** `a`, `d`, `g`, `p` fire only when the screen is in `list` state (not during any active text input sub-state like `add-title`, `add-company`, `add-jd`). In those sub-states, the global `inTextInput` flag already suppresses them, but the screen handler must also check its own state.

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `ConfirmPrompt`, `ScrollView`, `Spinner`, `ProgressSteps`, `StatusBadge`.

### ProfileEditorScreen

**Loads on mount:** `loadRefined()` or `loadSource()`.

**Navigation model:** local stack. Each level is a state: `section-list → section → position-list → position → bullets`. `Esc` pops; `Enter` pushes. Breadcrumb shown in content area header.

**States:**
- `section-list` — SelectList: Summary / Experience / Skills / Education / Certifications / Projects (TUI today: Summary, Experience, **Skills**; rest not built yet)
- `summary` — `InlineEditor` pre-filled with current summary; Enter saves, Esc discards
- `position-list` — SelectList of positions; `a` adds; `d` deletes (ConfirmPrompt)
- `position-detail` — shows role metadata; Enter → `bullets`
- `bullets` — SelectList: `↑↓` moves selection; **`[` / `]`** swaps the selected bullet with the previous/next row (reorder); `a` add, `d` delete, Enter → `bullet-edit` (implemented in TUI; `↑↓` cannot also swap without a mode switch, so reorder is `[` / `]`)
- `bullet-edit` — `InlineEditor` pre-filled; Enter saves, Esc discards
- `skills` — CheckboxList of all skills; space to toggle; s to save
- `education-list`, `certifications-list`, `projects-list` — similar pattern

**Save policy:** Changes are held in local component state (not global store) until the user presses `s` (save). On navigate-away (sidebar jump, `1–8`, Esc to sidebar), if unsaved changes exist, a `<ConfirmPrompt>` overlays the current state: "Unsaved changes — save before leaving? (Enter=save / n=discard / Esc=stay)". This is the resolved policy (see [Open questions](./tui-open-questions.md) — question 3). Writes via `saveRefined()` or `saveSource()`.

**No `$EDITOR`:** Profile editing is entirely inline. If a user wants to open the markdown in their editor, they do it via the CLI (`suited refine --edit`), not the TUI.

**Components:** `InlineEditor`, `SelectList`, `CheckboxList`, `ConfirmPrompt`, `ScrollView`.

### ContactScreen

**Loads on mount:** `loadContactMeta()` + current profile contact fields.

**States:**
- `form` — 7 `TextInput` fields (Name, Email, Phone, Location, LinkedIn, Website, GitHub); Tab advances
- `saving` — spinner; calls `mergeContactMeta(fields, profileDir)` which writes both `contact.json` and updates the active profile file
- `saved` — "Last saved: …" badge; back to `form`
- `error` — inline error; retry / back

**`mergeContactMeta` contract:** Takes the edited contact field values + `profileDir`, determines which profile file is active (refined > source), writes the contact fields into that profile, and writes `contact.json`. Does **not** call inquirer. Lives in `src/services/contact.ts`.

**Save:** `s` or "Save all" button saves all fields at once. Enter on a field saves that field and advances focus. Do not rely on blur.

**Components:** `TextInput`, `Spinner`, `StatusBadge`.

### SettingsScreen

**Loads on mount:** read `<project-root>/.env` (same path `dotenv` uses — resolve relative to the binary or `process.cwd()`) and `process.env` for API keys + output dir. If `.env` does not exist, treat all fields as empty — do not throw. Note: writing `.env` via the TUI does **not** hot-reload `process.env` in the running process; the user must restart `suited` for env changes to take effect. Show a notice: "Changes take effect on next launch."

**States:**
- `form` — API key (masked input), provider toggle (Anthropic/OpenRouter), output dir (TextInput), default flair (SelectList 1–5), headed browser toggle
- `saving` — writes to `.env`; spinner
- `saved` — success badge; back to form

**Security note:** API key display is masked after first 12 chars with `•`. Editing replaces the field; never displays the full key in full.

**API key validation on Save (normative semantics):**

- **Purpose:** Confirm the key is accepted by the selected provider before writing `.env`, without sending the user's resume or profile text.
- **Anthropic:** Use a **minimal** official API call (e.g. list models or the smallest supported request). **MUST NOT** embed user profile content in the validation request.
- **OpenRouter:** Same principle — document the exact endpoint in code comments; avoid high-token calls.
- **Latency / failure:** If the probe fails (401/403, invalid key), **SHOULD** show a clear inline error and **SHOULD NOT** write the key unless the user explicitly confirms "Save anyway" (optional escape hatch — decide in [Open questions](./tui-open-questions.md)).
- **Offline / timeout:** If the network is down, **SHOULD** distinguish "cannot reach API" from "key rejected"; **MAY** offer save-with-warning for offline development.

**Components:** `TextInput` (masked mode for key), `SelectList`, `ConfirmPrompt` (for overwriting `.env`), `Spinner`, `StatusBadge`.
