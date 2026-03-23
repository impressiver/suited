# Screen details

**Target shell:** **[`tui-document-shell.md`](./tui-document-shell.md)** is normative for the **document-first** UI: **Resume** = markdown viewport + optional outline; **Import / Settings / Contact / Generate** = **full-viewport overlays**; **Jobs** actions via **palette** or dialog; **Refine hub** via **palette**. **TopBar** = screen + **Job:** only; **StatusBar** = notifications + pipeline/health.

The sections below document the **sidebar-era** implementation (per-screen mount, state machines, components) and remain a **reference** until each flow is mounted under `DocumentShell` overlays. **No state may delegate to CLI or Inquirer** (Phase C). See [Phased delivery](./tui-phased-delivery.md).

### DocumentShell (target) — summary

| Overlay / mode | Loads | Notes |
|----------------|-------|--------|
| **Resume** | `Profile` for active `persistenceTarget`; **read-only** wrapped viewport without refined, **`FreeCursorMultilineInput`** + section strip when **`hasRefined`** (see [`tui-document-shell.md`](./tui-document-shell.md) §8) | `isMdNewerThanJson` global or `jobRefinedMdPath`+json job pair → sync banner |
| **Import** | Same as ImportScreen today | Returns to Resume on success / Esc |
| **Settings / Contact** | Same as today | TopBar label matches mode |
| **Generate** | `pendingJobId` + TopBar job precedence per document shell | Full wizard as overlay |
| **Jobs** | `loadJobs()` | Picker sets session job slug + TopBar `Job:` |
| **Refine hub** | Palette: Q&A, polish, sniff, consultant (whole + section-scoped), direct edit, history | Modals reuse RefineScreen state machines |
| **Profile editor** | From scoped **Edit** | Save via session dispatch only |

---

## Appendix: legacy sidebar-era screens

### DashboardScreen (Resume)

**Loads on mount:** snapshot via `fetchProfileSnapshot`; when `hasSource`, `loadActiveProfile` for markdown preview (`profileMarkdownContent`), health (`computeHealthScore` when refined), and validation. When **`hasRefined`**, additionally **`loadRefinedTuiState`** for the editable body + session target. Detects API key presence from `process.env`.

**First-run / missing directory:** If `profileDir` does not exist or `loadSource()` returns `null` (file not found — serializer **MUST** return `null`, not throw, for missing files), show `no-source` state. Do not throw or crash. The TUI is responsible for creating `profileDir` before the first write (mkdir -p semantics, delegated to whichever service performs the first write).

**States:**
- `no-api-key` — banner + Settings shortcut; all other actions disabled
- `no-source` — "Suggested next: Import" + Import shortcut
- `source-only` — suggest Refine; show import stats
- `refined` — suggest Generate or manage jobs; show health score from `computeHealthScore()`
- `ready` — has jobs + refined; suggest Generate; show last PDF details

**Components:** Without refined: **`TextViewport`** + **`ScrollView`** for **read-only** wrapped markdown. With refined: **`FreeCursorMultilineInput`** (debounced `onChange`, **`mdExternalRevision`** for external replaces only), section context strip (**`resumeSectionIdAtMarkdownOffset`** + experience **`pos-id`** label), inline polish **diff** + **`DiffView`**, **`StatusBadge`**, health/validation, suggested next. Pipeline strip on shell **StatusBar**. Navigation: **Esc** leaves editor focus for **`:`** palette, **`1–n`**, letter keys; **Tab** refocuses the editor; **`o`** / **Ctrl+O** outline; **Ctrl+S** save; **Ctrl+P** / **Ctrl+E** when API + body focused (see document shell §1, §8). Manual structured profile edit still under **Refine** / **Profile editor**.

### ImportScreen

**Loads on mount:** optional `clearSession` clears LinkedIn cookies file. **Layout:** import control (**URL/file** or **paste**) is **above** the on-disk preview so the primary field is obvious. **On disk:** reads `source.json` when present and shows name/headline, counts, up to five roles, and **full summary** (wrapped) in a `TextViewport` + `ScrollView` sized to `panelInnerWidth` / `panelFramedTextWidth`; **↑↓ PgUp/PgDn** scroll the preview when not in a text field. After a successful import, reloads preview and calls **`onSourceChanged`**.

**States (current implementation):**
- `idle` / `done` / `error` — single-line or paste input (labeled section + hints); **h** headed Chrome; **p** paste mode; **Esc** → **Resume** when Import’s outer `useInput` owns Esc (not in a text field)
- `running` — `Spinner`; `importProfileFromInput({ signal })` drives detect → scrape (URL, cooperative **`AbortSignal`** between nav steps) / ZIP+CSV / dir / Claude paste parse; **Esc** aborts via global `operationCancelSeq` + `useOperationAbort`
- `error` — message + **`SelectList`**: Retry (same input), optional **Check Settings** after 3 consecutive failures, Dismiss (return to idle)

**Still aspirational vs early spec:** granular `ProgressSteps`, dedicated `detecting`/`scraping` labels, post-import contact-only prompt as a separate state (contact is merged in the service today).

**Components:** `TextViewport`, `ScrollView`, `TextInput`, `Spinner`, `MultilineInput`, `SelectList` (error recovery).

### RefineScreen

**Loads on mount:** `loadRefined()` / `loadSource()`. If `refined.json` exists, start at **`already-refined`** menu; else start at **`first-refine-menu`** (Q&A pass **or** manual section edit on `source.json` — no auto-start Q&A until the user picks).

**Current TUI — `first-refine-menu`:** **Run Q&A from source (first refinement pass)** | **Edit profile sections (manual — source.json)** → sets `SET_PROFILE_EDITOR_RETURN_TO('refine')` and navigates to `ProfileEditorScreen`.

**Current TUI — already-refined menu:** `SelectList` with **Run Q&A from source**, **Polish sections (AI)**, **AI sniff pass** (reduce AI-looking phrasing on summary + experience + skills), **Professional consultant review (hiring manager, whole profile)**, **Section consultant review (summary, experience, or skills)** — same section labels as polish; **`evaluateProfileSection`** then shared **consultant-view** / apply / diff / keep-session, **Edit profile sections (manual)** → same navigation to `ProfileEditorScreen` (return **Esc** at section root returns to Refine when launched from here), **Direct edit**. No duplicate “open Jobs” / “stay” rows — use **:** / letter keys for navigation.

**Esc while a text field owns stdin:** **Q&A** answer draft and **Direct edit** input handle **Esc** locally (exit to the refine hub / cancel edit) even when `inTextInput` is true, so users are not stuck behind the global “suppress nav while typing” rule.

**External edit detection (`isMdNewerThanJson`):** The CLI checks whether `refined.md` has been externally edited (newer mtime than `refined.json`) and prompts sync. The TUI **MUST** replicate this check on mount. If `refined.md` is newer, show an inline banner inside the `already-refined` sub-menu: "Your `refined.md` was edited outside the TUI. Sync changes now?" with `<ConfirmPrompt>` → on yes, call `markdownToProfile()` + `saveRefined()`. This **must not** silently drop the external edits.

**States (implemented):**
```
no refined.json yet:
  → first-refine-menu         (SelectList: Q&A vs manual edit)
  → (Q&A path same as below from gen-questions onward)

not-refined (after choosing Q&A from first-refine-menu):
  → generating-questions      (spinner; generateRefinementQuestions)
  → qa-phase                  (`SelectList` of all questions + current detail + `TextInput`; **Shift+Tab** toggles focus between list and answer field; **↑↓** move selection when the list is focused; **Enter** on the list focuses the answer field; **Enter** in the field advances / runs apply on the last question; answers persist when changing index)
  → generating-refinements    (spinner; applyRefinements)
  → diff-review               (DiffView; accept / edit proposed summary / discard)
  → saving                    (spinner; saveRefined)
  → error / retry             (retryKind-specific; back uses disk check → first-refine-menu vs already-refined)

already-refined:
  → sub-menu (SelectList):
      Run Q&A from source
      Polish sections (AI)     → polish-pick → polish-run → diff-review (keep-session) → saving
      AI sniff pass            → ai-sniff-run → diff-review (keep-session, reason `ai-sniff`) → saving
      Professional consultant  → consultant-run → consultant-view → (apply all | choose suggestions) → optional follow-up Q&A per finding → consultant-apply → diff-review or done
      Edit profile sections    → navigate to ProfileEditorScreen (return via Esc at section root)
      Direct edit              → MultilineInput → direct-edit-run → diff-review (keep-session)
```

**Job-specific** hiring-manager feedback today stays on **Jobs** → job detail → **Professional feedback (job fit)** (`evaluateForJob`). The planned **Curate** screen (see [CurateScreen](#curatescreen-planned)) centralizes ongoing **job-scoped** polish, consultant, and edit flows; relationship to Jobs feedback is **normative** in the Curate table (shared module, optional **Open in Curate** routing).

**Key constraint:** Every sub-state renders inside `<RefineScreen>`. No sub-state spawns an Inquirer prompt or calls `runRefine`.

**Direct edit sub-flow:** `MultilineInput` → on submit, calls `applyDirectEdit(profile, instructions)` via `callWithToolStreaming` → shows streaming output → transitions to `diff-review` with the resulting changes.

**Polish sub-flow:** `polish-section-select` renders a `CheckboxList` of sections (Experience, Skills, etc.) and optionally a `SelectList` of positions to narrow scope. Only after the user confirms does the screen call `polishProfile(profile, { sections, positionIds })`. This mirrors the existing CLI's interactive section/position prompts — the TUI replaces those prompts with the CheckboxList step. **`runPolish`** also accepts optional **`positionIds`** from **`refineResumeIntent`** (dashboard / Resume editor handoff for a single experience role); polish **retry** preserves **`lastPolishPositionIdsRef`**.

**AI sniff sub-flow:** One-shot from the already-refined menu: `sniffReduceAiTellsProfile` (`AI_SNIFF_REDUCE_SYSTEM` + same refinements tool as polish) scans summary, all experience bullets, and skills when present. No section picker. Goal: fewer patterns that read as generic or machine-written, without adding facts. Same **diff-review** / **keep-session** path as polish; snapshot **`reason`:** `ai-sniff`.

**Consultant sub-flow:** After **consultant-view**, the user chooses **Apply all suggestions** or **Choose which suggestions to apply** (`CheckboxList`, same interaction as Generate section pick: Space · Enter). The screen then runs the same **follow-up question** step as the CLI (`fetchConsultantFeedbackQuestions` / `mergeConsultantFindingAnswers`): model-posed questions are answered one at a time with `TextInput` (blank allowed); then **`applyConsultantFindingsToProfile`** and **diff-review** as before. **Esc** from pick or follow-ups returns to **consultant-view** without losing the evaluation; **Esc** from **consultant-view** still returns to the refined hub and clears staged consultant state.

**Section consultant sub-flow:** From the already-refined menu → **consultant-section-pick** (`SelectList`: Summary / Experience / Skills, same scope as polish) → **consultant-section-run** (spinner; **`evaluateProfileSection`** with label optionally expanded for one experience role via **`buildExperiencePositionConsultantLabel`**, abort via **`useOperationAbort`**) → **consultant-view** (header copy notes section scope; preview lines include a **Section focus** line). **`runConsultantSectionReview(sectionLabel, { experiencePositionId? })`** is used from **`refineResumeIntent`** when **`positionId`** is set for experience. Apply / pick / follow-up / diff / keep-session match the whole-profile consultant path. **Esc** from the section picker returns to the refined hub.

**Prepare sub-flow:** Handled on **JobsScreen** (not Refine): saved job → Prepare → curation summary, etc.

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `DiffView`, `InlineEditor`, `Spinner`, `ScrollView`, `ConfirmPrompt`.

**Refinement history / revert:** [`refinement-history.md`](./refinement-history.md). **Refine** hub includes **View / restore refinement history** (list + confirm restore). CLI: `suited refine history list` / `restore <id>`.

**Backlog — side-by-side suggestion diffs:** Replace or augment unified `DiffView` with a **before | after** (side-by-side) layout for all AI-suggestion review steps above. Tracked as a post–Phase C task in [`tui-definition-of-done.md`](./tui-definition-of-done.md) (**Suggestion diffs (side-by-side)**).

### CurateScreen (planned)

**Purpose:** **Job-targeted curation of refined content** — same *family* of actions as **Refine** (polish, consultant, manual section edit, direct edit), but scoped to **one saved job** and a **per-job curated copy** of the profile derived from global **`refined.json`**, not the global refine hub.

**Relationship to other screens:**

| Screen / flow | Role |
|---------------|------|
| **Refine** | Global profile: Q&A from source, polish/consultant/direct edit on **refined** as a whole. |
| **Jobs → Prepare** | JD analysis + **curation plan** (what to include), persisted in `refinements/{jobId}.json`; inline summary in Jobs. |
| **Curate** | After (or alongside) that plan, **iterate the job-specific refined profile** — wording, sections, consultant pass — stored **per job** and **loaded by default** when the user reopens that job in Curate. |
| **Generate** | Consumes job context + stored artifacts to produce PDFs. |

**Consultant / job-fit (normative — avoid duplicate product models):** **Jobs → Professional feedback (job fit)** (`evaluateForJob` / `applyJobFeedback`) remains the **quick path** from the job detail card. **Curate → Professional consultant review** is a **deeper** pass over the **job-scoped profile** with JD context, analogous to **Refine → Professional consultant** but on the per-job copy. Implementation **SHOULD** reuse **one** consultant/evaluation module with explicit **scope** (`global-refined` vs `job-scoped profile` + `jobId`), not two divergent “consultant” stacks. When Curate ships, **Jobs** MAY route “extended review” to **Curate** instead of growing a second full hub on the job panel.

**Loads on mount:** Require **`refined.json`** (or equivalent active refined profile). If missing, show a short **blocked** state: refine the base profile first (link / shortcut to **Refine**). Load **`loadJobs()`** for the job list. Empty jobs → prompt to add jobs on **Jobs** or empty-state with sidebar shortcut.

**Prepare optional:** Curate **MUST** be usable **without** a prior **Prepare** run: if `refinements/{jobId}.json` / plan is missing, **initialize** the job-scoped copy from global **`refined.json`** alone (full profile or a later default — match **Generate**’s non-prepared job path). **Generate** SHOULD still work; Curate is an **optional** refinement step, not a hard gate.

**Top level — job list:** `SelectList` (or list + preview pattern consistent with **Jobs**) of saved jobs. **Selecting a job** resolves **`jobId`** (stable, from `SavedJob`) and **`job-slug`** for `jobs/{slug}/` using the **same** `makeJobSlug(company, title)` (or successor) as **Generate** / **prepare** so paths stay consistent. **Slug drift:** If the user edits company/title on the saved job, implementation **SHOULD** migrate or re-resolve the job-scoped directory for that `jobId` (or document a single canonical slug rule) so “load by default” does not silently point at a stale folder.

**Selecting a job — load path:** Load that job’s **saved curated profile** from disk when present (job-scoped refined JSON / optional markdown under `jobs/{slug}/` — same persistence model as CLI job-tailored editing). If none exists yet, **initialize** from current global **`refined.json`** plus the stored **curation plan** when available (`refinements/{jobId}.json`); otherwise from global refined only (see **Prepare optional** above).

**External edits (job-scoped markdown):** If `jobs/{slug}/refined.md` exists alongside JSON, the TUI **SHOULD** apply the same **external edit** pattern as Refine (`isMdNewerThanJson` → banner + confirm sync to JSON) so manual edits outside the app are not dropped.

**Per-job hub menu** (after a job is selected): `SelectList` of:

1. **Polish sections (AI)** — Same service contract as Refine’s polish path (`polishProfile` / section scope), run against the **loaded job-scoped profile**; diff-review → save to **that job’s** curated store.
2. **Professional consultant review** — Job-aware consultant pass on the **job-scoped profile** (hiring-manager style), analogous to Refine’s whole-profile consultant but **context = selected job**; then apply / diff-review → save per job.
3. **Edit profile sections (manual)** — Navigate to **`ProfileEditorScreen`** with **`profileEditorReturnTo('curate')`** (or equivalent), editing the **job-scoped** profile JSON backing store, not global refined only.
4. **Direct edit** — `MultilineInput` + direct-edit apply against the **job-scoped** profile; diff-review → save per job.
5. **Clear and start over** — **ConfirmPrompt**: discard the saved **curated copy** for this job and **rebuild from** the current global **`refined.json`** plus the stored **curation plan** when present; then return to the hub or reload the fresh copy. MUST NOT delete the saved **job record** or JD text on **Jobs** — only the job-scoped curated profile / overrides this screen owns. **SHOULD** also **clear `pinnedRender`** in `refinements/{jobId}.json` (see [`project.md` §7](./project.md#7-profile-directory-layout-conceptual)) so layout squeeze metadata does not outlive the discarded content.

**Persistence (normative):**

- **Curated data for each job** MUST be **saved separately** from global `refined.json` and MUST be **loaded by default** when that job is selected again in Curate.
- Implementation SHOULD reuse existing **job-scoped refined** paths (`jobs/{slug}/` JSON + optional markdown) and stay consistent with **Generate** / **prepare** consumers so one curated source of truth exists per job for tailored content.

**Esc / focus:** Same discipline as **Refine** and **Jobs** — **Curate** owns **Esc** to step back **job hub → job list → (optional) sidebar**; coordinate with **`App.tsx`** so global Esc does not steal back navigation while content is focused.

**Components:** `SelectList`, `CheckboxList` (polish scope), `MultilineInput`, `DiffView`, `Spinner`, `ScrollView`, `ConfirmPrompt`, `ProfileEditorScreen` (nested).

**Letter shortcut / sidebar index:** When implemented, add **Curate** as a **main sidebar row** (recommended order: after **Refine**, before **Generate**). **Letter jump: `u`** (see [`tui-open-questions.md`](./tui-open-questions.md)). Assign **`SCREEN_ORDER` index** and footer copy (`1–n`) in the same PR as the screen. **Renumbering:** Inserting a row **rebinds number keys** for every screen after the insertion point — document the new order in **footer hints** and release notes; users relearning `4 = Jobs` vs `5 = Jobs` is an explicit UX cost of the change.

### GenerateScreen

**Template and flair:** **Template** (baseline layout) and **flair level** are **independent** in the **TUI** (user picks both). **Flair** is specified as a dial on **variety** and **artistic license** vs the baseline — the **product direction** for higher flair is more room for a layout/design step to depart from template defaults while staying reference-grounded. **Today’s implementation** is largely **deterministic** (template files + `buildFitOverrideCss` squeeze tiers + industry caps via `getFlairInfo`); any future **designer-agent** styling MUST still honor §6 in [`project.md`](./project.md). **Settings → default flair** seeds the initial level only; it does not fix the template choice.

**Loads on mount:** If `pendingJobId` is set in `AppState`, clear it and jump to flair picker with that job’s JD.

**Current implementation (MVP):** source picker (**saved job** / **full resume** only — ad-hoc JD paste lives on **Jobs** when adding a job) → flair / template **`SelectList`** (flair levels 1–5 plus **Retro** and **Timeline** overrides, matching CLI `generate` prompts) → **`ProgressSteps` + `Spinner`** while **`runTuiGenerateBuildPhase`** runs (analyze / curate / assemble / polish for job path) → **`CheckboxList`** to include/exclude **summary, each position, education, skills, projects, certifications, languages, volunteer, awards**. **Experience floor:** the first **`MIN_VISIBLE_RESUME_POSITIONS` (3)** roles in document order are **always** included (locked in TUI, disabled in CLI) so PDFs stay substantive; **gap-fill** from index `0` through the max merged index still removes false timeline holes. → **`ProgressSteps` + `Spinner`** while **`runTuiGenerateRenderPhase`** runs (layout, squeeze, PDF, save config). **`runTuiGeneratePdf`** remains a one-shot **build + all sections + render** for non-TUI callers. **`throwIfAborted`** between major steps; **Esc** cancels build/render via **`useOperationAbort`**. **Retry** after a render failure re-runs **`runTuiGenerateRenderPhase`** with the same built document and section keys when available; otherwise rebuilds from flair. Errors: **`SelectList`** with Retry / optional Check Settings (after 3 failures) / back to flair; preflight errors (e.g. no saved jobs) offer back to source.

**Esc (non-running phases):** Like **Jobs**, **`App.tsx`** does not map **Esc** → sidebar while **Generate** content is focused — **`GenerateScreen`** owns **Esc** to step back through source / saved-job / flair / done / error states (including when a paste **`MultilineInput`** is focused). After the field blurs, a further **Esc** can return to the sidebar via the global handler.

**States (target / north star):**
```
idle:
  → jd-source-picker      (SelectList: use saved / no JD)
  → jd-saved-picker       (SelectList of saved jobs)
  → jd-confirmed          (show job title/company; go to config)

config:
  → template-picker       (SelectList of 5 templates)
  → flair-picker          (level 1–5; independent of template — sets designer-agent creative freedom vs baseline)

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
- Generate another (same job, same template + flair as last run)
- Change template and/or flair (same JD — return to config; choices remain independent)
- Generate for a different job (go back to `jd-source-picker`)
- Tweak content (`MultilineInput` → `tweak-running` → re-runs trim + PDF only; maps to `tweakResumeContent()`)

**Navigation** (Jobs, Dashboard, etc.) is the **sidebar** / number keys — not duplicated on the done row.

**`--jd` flag / `--all-templates`:** CLI-only. Not replicated in TUI. See [Goals & constraints](./tui-goals-and-constraints.md#coverage-validate-improve-prepare---jd-flag).

**Components:** `SelectList`, `MultilineInput`, `ProgressSteps`, `Spinner`, `ScrollView` (streaming), `CheckboxList` (Generate section pick + planned curation manual edit), `StatusBadge`.

### JobsScreen

**Loads on mount:** `loadJobs()`.

**Layout:** Job **list** and **Preview** are **always stacked** (preview below the list). **Detail** mode on wide layouts (**80+** cols, `jobsUseSplitPane`) keeps the job list visible on the left (read-only) with actions on the right (`jobsListPaneWidth` in `src/tui/jobsLayout.ts`).

**Errors:** Prepare failures offer **Retry prepare**, **Check Settings** after repeated failures, **Back to list** (`SelectList`); Esc still returns to list.

**States:**
- `list` — two-panel or stacked; job list left, detail right; active job highlighted
- `add-title` — TextInput for job title
- `add-company` — TextInput for company
- `add-jd` — MultilineInput for JD paste (panel width + wrap); **Ctrl+D** or **Ctrl+S** submits; calls `saveJob()`; inline + footer hints (footer still shows Jobs line while `inTextInput` via `App.tsx`)
- `delete-confirm` — `ConfirmPrompt` inline
- `view-jd` — `TextViewport` + wrapped `ScrollView` (PgUp/PgDn · ↑↓); dim line “Read-only · Esc…”; Esc → job menu
- `generate-navigate` — dispatches `SET_SCREEN('generate')` + `SET_PENDING_JOB(jobId)` simultaneously; GenerateScreen reads and clears `pendingJobId` on mount to pre-populate the JD source picker
- `prepare-curating` — inline curation spinner + streaming for the selected job
- `prepare-done` — summary; action row (→ Generate, → back). *(Planned:* optional **→ Curate** hand-off to [CurateScreen](#curatescreen-planned) with `pendingJobId` / equivalent so the same job opens in the curate hub.)
- `error` — error + retry / back

**All actions stay inside the TUI.** `g` dispatches `SET_SCREEN + SET_PENDING_JOB`; `p` runs the curation pipeline inline. **Prepare** produces the **curation plan**; deep **job-scoped** polish / consultant / edits belong on the planned **Curate** screen ([CurateScreen](#curatescreen-planned)), not duplicated as a second full editor on Jobs.

**Per-screen shortcuts active only in `list` state:** `a`, `d`, `g`, `p` fire only when the screen is in `list` state (not during any active text input sub-state like `add-title`, `add-company`, `add-jd`). In those sub-states, the global `inTextInput` flag already suppresses them, but the screen handler must also check its own state.

**Esc during add job (`add-title` / `add-company` / `add-jd`):** **`JobsScreen`** handles **Esc** *before* deferring to “text field owns keys” so **Esc** always backs out one wizard step (or to the list) even while **`TextInput`** / **`MultilineInput`** is focused. Global **App** **Esc** → sidebar is suppressed for **Jobs** content focus (same pattern as **Generate**).

**Components:** `SelectList`, `TextInput`, `MultilineInput`, `ConfirmPrompt`, `ScrollView`, `Spinner`, `ProgressSteps`, `StatusBadge`.

### ProfileEditorScreen

**Not in the sidebar.** Reached from **Refine** → *Edit profile sections (manual)*, and *(planned)* from **Curate** → *Edit profile sections* for the **job-scoped** profile. Store flag **`profileEditorReturnTo`** (`'refine'` | `'curate'` when implemented) so **Esc** at the section list (no unsaved edits) returns to the correct hub instead of only focusing the sidebar. **`profileEditorJobContext` *(planned)*:** when launching from Curate, persist **`jobId`** and resolved **`slug`** (or equivalent) in `AppState` so the editor knows which job-scoped store to read/write.

**Loads on mount:**

- **`profileEditorReturnTo === 'refine'` (today):** `loadRefined()` or `loadSource()` — refined.json wins over source when present.
- **`profileEditorReturnTo === 'curate'` *(planned)*:** `loadJobRefinedProfile(profileDir, slug)` when a job-scoped JSON exists; otherwise build initial in-memory profile from global **`refined.json`** + curation plan (same assembly rules as **Generate** / prepare consumers) and treat as **dirty** until first **Save**, or persist on first save per product choice — **MUST NOT** silently write global `refined.json` when editing from Curate.

**Save:** Refine path: `saveRefined()` / `saveSource()` as today. Curate path *(planned)*: **`saveJobRefinedProfile`** (and optional `profileToMarkdown` to `jobs/{slug}/refined.md` if markdown parity is kept). **s** key saves the **active** target only.

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

**Save policy:** Changes are held in local component state (not global store) until the user presses `s` (save). On navigate-away (sidebar jump, number keys, Esc to sidebar / return screen), if unsaved changes exist, **`App`** shows `<ConfirmPrompt>` and **disables global `useInput`** until the user resolves it (see [Architecture — Modal vs global input](./tui-architecture.md#modal-vs-global-input-confirmprompt)). Writes via `saveRefined()`, `saveSource()`, or *(planned)* `saveJobRefinedProfile` when the active target is job-scoped. **Global `s`→Settings** is **deferred** on Profile content focus so **`s`** means save here.

**No `$EDITOR`:** Profile editing is entirely inline. If a user wants to open the markdown in their editor, they do it via the CLI (`suited refine --edit`), not the TUI.

**Manual edit vs AI on Refine:** Structured editing is **Refine → Edit profile sections (manual)**. **General** hiring-consultant feedback stays **Refine → Professional consultant review**.

**Components:** `InlineEditor`, `SelectList`, `CheckboxList`, `ConfirmPrompt`, `ScrollView`.

### ContactScreen

**Loads on mount:** `loadContactMeta()` + current profile contact fields.

**States:**
- `form` — 7 `TextInput` fields (Name, Email, Phone, Location, LinkedIn, Website, GitHub); Tab advances
- `saving` — spinner; calls `mergeContactMeta(fields, profileDir, { persistenceTarget })` so profile writes follow the document target; always merges **global** contact config (`contact.json` under the suited XDG config directory)
- `saved` — "Last saved: …" badge; back to `form`
- `error` — inline error; retry / back

**`mergeContactMeta` contract:** Takes the edited contact field values + `profileDir` + optional `{ persistenceTarget }` (default = global-refined / legacy CLI). **Global:** base profile `loadActiveProfile`; persist `saveRefined` if global `refined.json` exists, else `saveSource` + source markdown. **Job:** base `loadJobRefinedProfile(profileDir, slug)` if present, else `loadActiveProfile`; persist **only** `saveJobRefinedProfile` (never global `saveRefined`). Always merges the same plain-string fields into **global** contact metadata (XDG config path, not under `profileDir`). Does **not** call inquirer. Lives in `src/services/contact.ts`.

**Save:** `s` saves all fields at once (browse mode). **`App`** defers global **`s`→Settings** on Contact content focus so **`s`** is not stolen. Enter on a field saves that field and advances focus. Do not rely on blur.

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
- **Latency / failure:** If the probe fails (401/403, invalid key, timeout), show a clear inline status message and **do not** write `.env`. **No "Save anyway"** in the current TUI — avoids persisting keys that failed validation. (Optional offline-only escape hatch remains a future explicit product choice.)
- **Offline / timeout:** Distinguish "cannot reach API" vs "key rejected" in copy where feasible; still **block write** until probe succeeds (today).

**Components:** `TextInput` (masked mode for key), `SelectList`, `Spinner`, status lines (no confirm overlay for save today).
