# State machines (Mermaid)

High-level diagrams for the two largest flows. **Screen details** in [screens.md](./tui-screens.md) are authoritative for edge cases.

> **Notation:** `cancelled` is distinct from `error`. `cancelled` = user aborted via Esc/AbortSignal; show "Cancelled" + Retry / Back. `error` = unexpected failure; show error message + Retry / Edit / Back.

---

## RefineScreen (not refined — happy path + error/cancel)

```mermaid
stateDiagram-v2
  [*] --> generating_questions : start
  generating_questions --> qa_phase : questions ready
  qa_phase --> generating_refinements : answers complete
  generating_refinements --> diff_review : refinements ready
  diff_review --> saving : user accepts all blocks
  saving --> consultant_running : save ok
  consultant_running --> consultant_done : stream complete
  consultant_done --> [*] : user chooses action (Generate / Back)

  generating_questions --> error : API/parse failure
  generating_questions --> cancelled : AbortSignal
  qa_phase --> cancelled : user Esc from sub-state
  generating_refinements --> error : API/parse failure
  generating_refinements --> cancelled : AbortSignal
  saving --> error : write failure
  consultant_running --> cancelled : AbortSignal / first Esc
  error --> generating_questions : retry
  error --> [*] : back
  cancelled --> [*] : back
```

---

## RefineScreen (already refined — sub-menu)

```mermaid
stateDiagram-v2
  [*] --> sub_menu

  sub_menu --> consultant_running : "Run consultant review"
  consultant_running --> consultant_done : stream complete
  consultant_done --> sub_menu : back
  consultant_done --> [*] : navigate to Generate
  consultant_running --> cancelled : AbortSignal

  sub_menu --> polish_section_select : "Polish bullets (AI)"
  polish_section_select --> polish_running : sections chosen
  polish_running --> diff_review : polish complete
  polish_running --> cancelled : AbortSignal
  diff_review --> saving : accepted
  diff_review --> sub_menu : discarded / back
  saving --> sub_menu : save ok

  sub_menu --> generating_questions : "Rerun Q&A"
  generating_questions --> qa_phase : questions ready
  qa_phase --> generating_refinements : answers complete
  generating_refinements --> diff_review_rerun : done
  diff_review_rerun --> saving_rerun : accepted
  saving_rerun --> sub_menu : saved

  sub_menu --> direct_edit_input : "Apply direct edit"
  direct_edit_input --> direct_edit_running : submitted
  direct_edit_running --> diff_review_edit : changes ready
  direct_edit_running --> cancelled : AbortSignal
  diff_review_edit --> saving_edit : accepted
  saving_edit --> sub_menu : saved

  sub_menu --> job_picker : "Prepare for a saved job"
  job_picker --> curation_running : job selected
  curation_running --> curation_summary : done
  curation_running --> cancelled : AbortSignal
  curation_summary --> sub_menu : back
  curation_summary --> [*] : navigate to Generate

  cancelled --> sub_menu : back
  error --> sub_menu : back / retry
```

**Note on polish pre-selection:** `polish_section_select` is a `CheckboxList` that lets the user pick which sections (Experience, Skills, etc.) and optionally which positions to polish. This must happen **before** calling `polishProfile()`. The existing CLI does this interactively; the TUI replaces those prompts with a CheckboxList + optional position SelectList before starting the API call.

---

## GenerateScreen (pipeline)

```mermaid
stateDiagram-v2
  [*] --> jd_source

  jd_source --> jd_paste : paste
  jd_source --> jd_saved : saved job
  jd_source --> jd_confirmed : no JD
  jd_paste --> jd_confirmed : Ctrl+D
  jd_saved --> jd_confirmed : job selected
  jd_confirmed --> template_config : confirm

  template_config --> analyzing_jd : start pipeline

  analyzing_jd --> jd_analysis_review : analysis ready
  jd_analysis_review --> curating : confirm
  jd_analysis_review --> analyzing_jd : re-analyze (loops back)

  curating --> curation_preview : done
  curation_preview --> polishing : continue
  curation_preview --> curating : rerun
  curation_preview --> curation_manual_edit : edit manually
  curation_manual_edit --> curation_preview : done editing

  polishing --> consulting : done
  consulting --> trimming : done
  trimming --> exporting_pdf : done
  exporting_pdf --> done

  done --> jd_source : generate for different job
  done --> template_config : change template/flair (same JD)
  done --> tweak_input : tweak content
  tweak_input --> tweak_running : submitted
  tweak_running --> done : tweaked

  analyzing_jd --> error : failure
  analyzing_jd --> cancelled : AbortSignal
  curating --> error : failure
  curating --> cancelled : AbortSignal
  polishing --> cancelled : AbortSignal
  consulting --> cancelled : AbortSignal
  tweak_running --> cancelled : AbortSignal

  error --> jd_confirmed : retry from config
  error --> [*] : back
  cancelled --> template_config : back to config
  cancelled --> [*] : back to Dashboard
```

**`tweak_input` / `tweak_running`:** These map to `tweakResumeContent()` in the existing CLI (post-generation natural-language edits). The `MultilineInput` collects the instruction; the result replaces the current `ResumeDocument` and re-runs only trimming + PDF export.

*(Step names match [screens.md](./tui-screens.md#generatescreen).)*
