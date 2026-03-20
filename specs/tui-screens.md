# Screen details

Every screen documents: what loads on mount, the full state machine (every state the screen can be in), and which shared components handle each state. **No state may delegate to CLI or Inquirer** (Phase C). See [Phased delivery](./tui-phased-delivery.md).

### DashboardScreen

**Loads on mount:** `loadSource()`, `loadRefined()`, `loadGenerationConfig()`. Detects API key presence from `process.env`.

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

**States:**
```
not-refined:
  → generating-questions      (spinner; calls generateRefinementQuestions)
  → qa-phase                  (TextInput per question; questions[index] rendered inline)
  → generating-refinements    (spinner; calls applyRefinements with answers)
  → diff-review               (DiffView per block; accept / edit-inline / discard)
  → saving                    (spinner; calls saveRefined)
  → consultant-running        (streaming; calls evaluateProfileForJob)
  → done                      (action row: Generate / Back)
  → error                     (error + retry)

already-refined:
  → sub-menu (SelectList):
      "Run consultant review"      → consultant-running
      "Polish bullets (AI)"        → polish-running → diff-review
      "Rerun Q&A from scratch"     → generating-questions (same flow as not-refined)
      "Apply direct edit"          → direct-edit-input → direct-edit-running → diff-review
      "Prepare for a saved job"    → job-picker → curation-running → curation-summary
```

**Key constraint:** Every sub-state renders inside `<RefineScreen>`. No sub-state spawns an Inquirer prompt or calls `runRefine`.

**Direct edit sub-flow:** `MultilineInput` → on submit, calls `applyDirectEdit(profile, instructions)` via `callWithToolStreaming` → shows streaming output → transitions to `diff-review` with the resulting changes.

**Prepare sub-flow:** `SelectList` of saved jobs → on select, calls `curateForJob()` with streaming → shows `ProgressSteps` → shows curation summary → action row (accept + save, rerun, back).

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `DiffView`, `InlineEditor`, `Spinner`, `ProgressSteps`, `ScrollView` (streaming output), `ConfirmPrompt`.

### GenerateScreen

**Loads on mount:** `loadRefined()` or `loadSource()`, `loadJobs()`, `loadGenerationConfig()` (pre-populate last template/flair).

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
  → polishing             (step 3/6; spinner + streaming)
  → consulting            (step 4/6; spinner + streaming; show consultant output)
  → trimming              (step 5/6; spinner)
  → exporting-pdf         (step 6/6; spinner)
  → done                  (show path + fit%; action row)
  → error                 (error + retry same step or restart)
```

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
- `generate-navigate` — navigates to GenerateScreen with job pre-selected (uses `SET_SCREEN` action)
- `prepare-curating` — inline curation spinner + streaming for the selected job
- `prepare-done` — summary; action row (→ Generate, → back)
- `error` — error + retry / back

**All actions stay inside the TUI.** `g` triggers `SET_SCREEN` + pre-selection; `p` runs the curation pipeline inline.

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `ConfirmPrompt`, `ScrollView`, `Spinner`, `ProgressSteps`, `StatusBadge`.

### ProfileEditorScreen

**Loads on mount:** `loadRefined()` or `loadSource()`.

**Navigation model:** local stack. Each level is a state: `section-list → section → position-list → position → bullets`. `Esc` pops; `Enter` pushes. Breadcrumb shown in content area header.

**States:**
- `section-list` — SelectList: Summary / Experience / Skills / Education / Certifications / Projects
- `summary` — `InlineEditor` pre-filled with current summary; Enter saves, Esc discards
- `position-list` — SelectList of positions; `a` adds; `d` deletes (ConfirmPrompt)
- `position-detail` — shows role metadata; Enter → `bullets`
- `bullets` — SelectList of bullets with `↑↓` reorder, `a` add, `d` delete, Enter → `bullet-edit`
- `bullet-edit` — `InlineEditor` pre-filled; Enter saves, Esc discards
- `skills` — CheckboxList of all skills; space to toggle; s to save
- `education-list`, `certifications-list`, `projects-list` — similar pattern

**Save policy:** changes are held in local component state until the user presses `s` (save) or navigates away with a confirm prompt. Writes via `saveRefined()` or `saveSource()`.

**No `$EDITOR`:** Profile editing is entirely inline. If a user wants to open the markdown in their editor, they do it via the CLI (`suited refine --edit`), not the TUI.

**Components:** `InlineEditor`, `SelectList`, `CheckboxList`, `ConfirmPrompt`, `ScrollView`.

### ContactScreen

**Loads on mount:** `loadContactMeta()` + current profile contact fields.

**States:**
- `form` — 7 `TextInput` fields (Name, Email, Phone, Location, LinkedIn, Website, GitHub); Tab advances
- `saving` — spinner; calls `saveContactMeta()` + `mergeContactMeta()`
- `saved` — "Last saved: …" badge; back to `form`
- `error` — inline error; retry / back

**Save:** `s` or "Save all" button saves all fields at once. Enter on a field saves that field and advances focus. Do not rely on blur.

**Components:** `TextInput`, `Spinner`, `StatusBadge`.

### SettingsScreen

**Loads on mount:** read `.env` and `process.env` for API keys + output dir.

**States:**
- `form` — API key (masked input), provider toggle (Anthropic/OpenRouter), output dir (TextInput), default flair (SelectList 1–5), headed browser toggle
- `saving` — writes to `.env`; spinner
- `saved` — success badge; back to form

**Security note:** API key display is masked after first 12 chars with `•`. Editing replaces the field; never displays the full key in full.

**API key validation on Save (normative semantics):**

- **Purpose:** Confirm the key is accepted by the selected provider before writing `.env`, without sending the user’s resume or profile text.
- **Anthropic:** Use a **minimal** official API call (e.g. list models or the smallest supported request). **MUST NOT** embed user profile content in the validation request.
- **OpenRouter:** Same principle — document the exact endpoint in code comments; avoid high-token calls.
- **Latency / failure:** If the probe fails (401/403, invalid key), **SHOULD** show a clear inline error and **SHOULD NOT** write the key unless the user explicitly confirms "Save anyway" (optional escape hatch — decide in [Open questions](./tui-open-questions.md)).
- **Offline / timeout:** If the network is down, **SHOULD** distinguish "cannot reach API" from "key rejected"; **MAY** offer save-with-warning for offline development.

**Components:** `TextInput` (masked mode for key), `SelectList`, `ConfirmPrompt` (for overwriting `.env`), `Spinner`, `StatusBadge`.

