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

**Components:** `StatusBadge` (pipeline), `ScrollView` (pipeline + activity). Navigation matches the left sidebar (`1–7` and letter keys; no eighth sidebar row — manual profile edit is under **Refine**).

### ImportScreen

**Loads on mount:** optional `clearSession` clears LinkedIn cookies file. **Current source:** reads `source.json` when present and shows a compact preview (name/headline, counts, up to five roles, truncated summary) in a `ScrollView`; after a successful import, reloads preview and calls **`onSourceChanged`** (wired to `useProfileSnapshot.refresh` in `App`) so the header stays in sync.

**States (current implementation):**
- `idle` / `done` / `error` — single-line or paste input; **h** toggles headed Chrome for URL scrape; **p** toggles paste mode; **Esc** returns to the sidebar even while the line/paste field is focused (global `App` input is suppressed during text entry, so Import handles this locally)
- `running` — `Spinner`; `importProfileFromInput({ signal })` drives detect → scrape (URL, cooperative **`AbortSignal`** between nav steps) / ZIP+CSV / dir / Claude paste parse; **Esc** aborts via global `operationCancelSeq` + `useOperationAbort`
- `error` — message + **`SelectList`**: Retry (same input), optional **Check Settings** after 3 consecutive failures, Dismiss (return to idle)

**Still aspirational vs early spec:** granular `ProgressSteps`, dedicated `detecting`/`scraping` labels, post-import contact-only prompt as a separate state (contact is merged in the service today).

**Components:** `ScrollView` (source preview), `TextInput`, `Spinner`, `MultilineInput`, `SelectList` (error recovery).

### RefineScreen

**Loads on mount:** `loadRefined()` / `loadSource()`. If `refined.json` exists, start at **`already-refined`** menu; else start at **`first-refine-menu`** (Q&A pass **or** manual section edit on `source.json` — no auto-start Q&A until the user picks).

**Current TUI — `first-refine-menu`:** **Run Q&A from source (first refinement pass)** | **Edit profile sections (manual — source.json)** → sets `SET_PROFILE_EDITOR_RETURN_TO('refine')` and navigates to `ProfileEditorScreen`.

**Current TUI — already-refined menu:** `SelectList` with **Run Q&A from source**, **Polish sections (AI)**, **Professional consultant review (hiring manager, whole profile)**, **Edit profile sections (manual)** → same navigation to `ProfileEditorScreen` (return **Esc** at section root returns to Refine when launched from here), **Direct edit**. No duplicate “open Jobs” / “stay” rows — use the **sidebar** for navigation.

**Esc while a text field owns stdin:** **Q&A** answer draft and **Direct edit** input handle **Esc** locally (exit to the refine hub / cancel edit) even when `inTextInput` is true, so users are not stuck behind the global “suppress nav while typing” rule.

**External edit detection (`isMdNewerThanJson`):** The CLI checks whether `refined.md` has been externally edited (newer mtime than `refined.json`) and prompts sync. The TUI **MUST** replicate this check on mount. If `refined.md` is newer, show an inline banner inside the `already-refined` sub-menu: "Your `refined.md` was edited outside the TUI. Sync changes now?" with `<ConfirmPrompt>` → on yes, call `markdownToProfile()` + `saveRefined()`. This **must not** silently drop the external edits.

**States (implemented):**
```
no refined.json yet:
  → first-refine-menu         (SelectList: Q&A vs manual edit)
  → (Q&A path same as below from gen-questions onward)

not-refined (after choosing Q&A from first-refine-menu):
  → generating-questions      (spinner; generateRefinementQuestions)
  → qa-phase                  (TextInput per question)
  → generating-refinements    (spinner; applyRefinements)
  → diff-review               (DiffView; accept / edit proposed summary / discard)
  → saving                    (spinner; saveRefined)
  → error / retry             (retryKind-specific; back uses disk check → first-refine-menu vs already-refined)

already-refined:
  → sub-menu (SelectList):
      Run Q&A from source
      Polish sections (AI)     → polish-pick → polish-run → diff-review (keep-session) → saving
      Professional consultant  → consultant-run → consultant-view → consultant-apply → diff-review or done
      Edit profile sections    → navigate to ProfileEditorScreen (return via Esc at section root)
      Direct edit              → MultilineInput → direct-edit-run → diff-review (keep-session)
```

**Job-specific** hiring-manager feedback stays on **Jobs** → job detail → **Professional feedback (job fit)** (`evaluateForJob`), not on Refine.

**Key constraint:** Every sub-state renders inside `<RefineScreen>`. No sub-state spawns an Inquirer prompt or calls `runRefine`.

**Direct edit sub-flow:** `MultilineInput` → on submit, calls `applyDirectEdit(profile, instructions)` via `callWithToolStreaming` → shows streaming output → transitions to `diff-review` with the resulting changes.

**Polish sub-flow:** `polish-section-select` renders a `CheckboxList` of sections (Experience, Skills, etc.) and optionally a `SelectList` of positions to narrow scope. Only after the user confirms does the screen call `polishProfile(profile, { sections, positionIds })`. This mirrors the existing CLI's interactive section/position prompts — the TUI replaces those prompts with the CheckboxList step.

**Prepare sub-flow:** Handled on **JobsScreen** (not Refine): saved job → Prepare → curation summary, etc.

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `DiffView`, `InlineEditor`, `Spinner`, `ScrollView`, `ConfirmPrompt`.

**Backlog — side-by-side suggestion diffs:** Replace or augment unified `DiffView` with a **before | after** (side-by-side) layout for all AI-suggestion review steps above. Tracked as a post–Phase C task in [`tui-definition-of-done.md`](./tui-definition-of-done.md) (**Suggestion diffs (side-by-side)**).

### GenerateScreen

**Loads on mount:** If `pendingJobId` is set in `AppState`, clear it and jump to flair picker with that job’s JD.

**Current implementation (MVP):** source picker (**saved job** / **full resume** only — ad-hoc JD paste lives on **Jobs** when adding a job) → flair **`SelectList`** → single **`Spinner`** while `runTuiGeneratePdf` runs. **`runTuiGeneratePdf({ signal })`** checks `throwIfAborted` between major steps; **Esc** cancels via **`useOperationAbort`**. Errors: **`SelectList`** with Retry / optional Check Settings (after 3 failures) / back to flair; preflight errors (e.g. no saved jobs) offer back to source.

**Esc (non-running phases):** Like **Jobs**, **`App.tsx`** does not map **Esc** → sidebar while **Generate** content is focused — **`GenerateScreen`** owns **Esc** to step back through source / saved-job / flair / done / error states (including when a paste **`MultilineInput`** is focused). After the field blurs, a further **Esc** can return to the sidebar via the global handler.

**States (target / north star):**
```
idle:
  → jd-source-picker      (SelectList: use saved / no JD)
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

**Navigation** (Jobs, Dashboard, etc.) is the **sidebar** / number keys — not duplicated on the done row.

**`--jd` flag / `--all-templates`:** CLI-only. Not replicated in TUI. See [Goals & constraints](./tui-goals-and-constraints.md#coverage-validate-improve-prepare---jd-flag).

**Components:** `SelectList`, `MultilineInput`, `ProgressSteps`, `Spinner`, `ScrollView` (streaming), `CheckboxList` (curation manual edit), `StatusBadge`.

### JobsScreen

**Loads on mount:** `loadJobs()`.

**Layout:** Job **list** and **Preview** are **always stacked** (preview below the list). **Detail** mode on wide layouts (**80+** cols, `jobsUseSplitPane`) keeps the job list visible on the left (read-only) with actions on the right (`jobsListPaneWidth` in `src/tui/jobsLayout.ts`).

**Errors:** Prepare failures offer **Retry prepare**, **Check Settings** after repeated failures, **Back to list** (`SelectList`); Esc still returns to list.

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

**Esc during add job (`add-title` / `add-company` / `add-jd`):** **`JobsScreen`** handles **Esc** *before* deferring to “text field owns keys” so **Esc** always backs out one wizard step (or to the list) even while **`TextInput`** / **`MultilineInput`** is focused. Global **App** **Esc** → sidebar is suppressed for **Jobs** content focus (same pattern as **Generate**).

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `ConfirmPrompt`, `ScrollView`, `Spinner`, `ProgressSteps`, `StatusBadge`.

### ProfileEditorScreen

**Not in the sidebar.** Reached from **Refine** → *Edit profile sections (manual)*. Store flag **`profileEditorReturnTo`** (typically `'refine'`) so **Esc** at the section list (no unsaved edits) navigates back to Refine instead of only focusing the sidebar.

**Loads on mount:** `loadRefined()` or `loadSource()` (same rule as before: refined.json wins).

**Navigation model:** local stack. Each level is a state: `section-list → section → position-list → position → bullets`. `Esc` pops; `Enter` pushes. Breadcrumb shown in content area header.

**States:**
- `section-list` — SelectList: Summary / Experience / Skills / Education / Certifications / Projects (**all** present in TUI; Education/Certs/Projects use the same list + **`[`/`]`** + a/d pattern as Skills — primary field edit only unless noted)
- `summary` — `InlineEditor` pre-filled with current summary; Enter saves, Esc discards
- `position-list` — SelectList of positions; `a` adds; `d` deletes (`ConfirmPrompt`); **`[`** / **`]`** reorder (TUI)
- `position-detail` — shows role metadata; Enter → `bullets`
- `bullets` — SelectList: `↑↓` moves selection; **`[` / `]`** swaps the selected bullet with the previous/next row (reorder); `a` add, `d` delete, Enter → `bullet-edit` (implemented in TUI; `↑↓` cannot also swap without a mode switch, so reorder is `[` / `]`)
- `bullet-edit` — `InlineEditor` pre-filled; Enter saves, Esc discards
- `skills` — CheckboxList of all skills; space to toggle; s to save
- `education-list`, `certifications-list`, `projects-list` — similar pattern

**Save policy:** Changes are held in local component state (not global store) until the user presses `s` (save). On navigate-away (sidebar jump, number keys, Esc to sidebar / return screen), if unsaved changes exist, a `<ConfirmPrompt>` overlays the current state: "Unsaved changes — save before leaving? (Enter=save / n=discard / Esc=stay)". This is the resolved policy (see [Open questions](./tui-open-questions.md) — question 3). Writes via `saveRefined()` or `saveSource()`.

**No `$EDITOR`:** Profile editing is entirely inline. If a user wants to open the markdown in their editor, they do it via the CLI (`suited refine --edit`), not the TUI.

**Manual edit vs AI on Refine:** Structured editing is **Refine → Edit profile sections (manual)**. **General** hiring-consultant feedback stays **Refine → Professional consultant review**.

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

**Esc with API key field focused:** First **Esc** moves focus back to the **provider** list (so **`inTextInput`** clears); second **Esc** (with content focus, not in a field) returns to the **sidebar** via **`App`**.

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
