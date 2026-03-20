# State machines (Mermaid)

High-level diagrams for the two largest flows. **Screen details** in [screens.md](./screens.md) are authoritative for edge cases.

## RefineScreen (not refined — happy path)

```mermaid
stateDiagram-v2
  [*] --> not_refined
  not_refined --> generating_questions : start
  generating_questions --> qa_phase : questions ready
  qa_phase --> generating_refinements : answers complete
  generating_refinements --> diff_review : refinements ready
  diff_review --> saving : user accepts
  saving --> done : save ok
  diff_review --> error : failure
  generating_questions --> error
  qa_phase --> error
  generating_refinements --> error
  saving --> error
  error --> [*]
  done --> [*]
```

## RefineScreen (already refined — sub-menu)

```mermaid
stateDiagram-v2
  [*] --> sub_menu
  sub_menu --> consultant_running : consultant
  sub_menu --> polish_running : polish
  sub_menu --> generating_questions : rerun Q&A
  sub_menu --> direct_edit : direct edit
  sub_menu --> job_picker : prepare
  consultant_running --> [*]
  polish_running --> diff_review
  diff_review --> [*]
```

## GenerateScreen (pipeline)

```mermaid
stateDiagram-v2
  [*] --> jd_source
  jd_source --> jd_paste : paste
  jd_source --> jd_saved : saved job
  jd_source --> jd_confirmed : no JD
  jd_paste --> jd_confirmed
  jd_saved --> jd_confirmed
  jd_confirmed --> template_config
  template_config --> analyzing_jd
  analyzing_jd --> curating
  curating --> curation_preview
  curation_preview --> polishing
  polishing --> consulting
  consulting --> trimming
  trimming --> exporting_pdf
  exporting_pdf --> done
  analyzing_jd --> error
  curating --> error
  done --> [*]
  error --> [*]
```

*(Step names are illustrative; exact states match [screens.md](./screens.md#generatescreen).)*
