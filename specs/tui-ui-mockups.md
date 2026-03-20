# UI mockups (target appearance)

ASCII wireframes at ~80 columns. Real Ink output may use bold/dim and optional color; semantics must match. Narrow-terminal variants noted where layout changes.

### Shell layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  12 positions  ·  refined ✓                        │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 1 Dashboard │  Suggested next: Run refine on your profile                  │
│   2 Import    │  ────────────────────────────────────────────────────────    │
│   3 Refine    │  Pipeline                                                    │
│   4 Generate  │    Source [●]  Refined [●]  Jobs [●]  Last PDF [●]          │
│   5 Jobs      │  Activity                                                  │
│   6 Profile   │    Jobs saved: 3 · Last PDF: …                              │
│   7 Contact   │                                                              │
│   8 Settings  │                                                              │
│               │                                                              │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Tab focus  ·  ↑↓ select  ·  Enter open  ·  1–8 screen  ·  q quit           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Dashboard — no API key

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  (no profile)                                                      │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 1 Dashboard │  ! API key not configured.                                   │
│   2 Import    │    Set ANTHROPIC_API_KEY or open Settings (8).               │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Suggested next: Configure API access                        │
│               │  ► Open Settings                                             │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Enter: activate  ·  8: Settings  ·  q quit                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Import — scraping in progress

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  importing…                                        │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   1 Dashboard │  Import LinkedIn profile                                     │
│ ► 2 Import    │  ────────────────────────────────────────────────────────    │
│   3 Refine    │  ● Detecting ──● Scraping ──○ Parsing ──○ Done              │
│   …           │                                                              │
│               │  ⠋ Scraping page…                                           │
│               │                                                              │
│               │  (sidebar grayed; navigation locked)                        │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Esc: cancel scrape  ·  navigation locked until done                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — already-refined sub-menu

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  refined ✓                                         │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   2 Import    │  Refine profile                                              │
│ ► 3 Refine    │  Profile is already refined. What would you like to do?      │
│   4 Generate  │  ────────────────────────────────────────────────────────    │
│   …           │    Run hiring consultant review                              │
│               │  ► Polish bullets (AI rewrite)                              │
│               │    Rerun Q&A from scratch                                   │
│               │    Apply direct edit (free-form instructions)                │
│               │    Edit profile manually (opens $EDITOR)                    │
│               │    Prepare for a saved job                                  │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter confirm  ·  Esc back                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — Q&A phase

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  refining…                                         │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   2 Import    │  Refine profile                     Question 3 of 12        │
│ ► 3 Refine    │  ────────────────────────────────────────────────────────    │
│   4 Generate  │  Did you lead the migration from monolith to services?      │
│   …           │                                                              │
│               │  Your answer                                                 │
│               │  [ Yes, I owned the roadmap and cutover…_________________ ] │
│               │                                                              │
│               │  Enter: submit  ·  skip (leave blank + Enter)               │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Input mode: q does NOT quit  ·  Esc: blur / skip question                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — diff review

Prefix symbols (`-`/`+`) carry meaning without color; red/green supplements when available:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  review changes                                    │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 3 Refine    │  Review proposed edits                         Block 2 / 8  │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  - Led a team of 5 engineers                                │
│               │  + Led a team of 8 engineers across platform and data       │
│               │                                                              │
│               │  ► Accept as-is                                             │
│               │    Edit before apply                                        │
│               │    Discard block                                            │
│               │                                                              │
│               │  ↑↓ choose  ·  Enter confirm  ·  Esc: exit review          │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Diff review: per-block actions  ·  Esc: previous sub-state                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — inline editor (edit-before-apply)

When the user picks "Edit before apply", the diff block stays visible and an inline editor appears below with the proposed text pre-filled:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  editing…                                          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 3 Refine    │  Edit proposed change                          Block 2 / 8  │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Original:  - Led a team of 5 engineers                     │
│               │  Proposed:  + Led a team of 8 engineers across platform…    │
│               │                                                              │
│               │  Your edit:                                                  │
│               │  [ Led a team of 8 engineers across platform and data____] │
│               │                                                              │
│               │  Enter: apply edited version  ·  Esc: back to choice       │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Input mode: q does NOT quit  ·  Esc: back                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — consultant output

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  consulting…                                       │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 3 Refine    │  Hiring consultant review                                   │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  ⠋ Calling model…                                           │
│               │                                                              │
│               │  (streaming output appears here as it arrives)              │
│               │  The profile shows strong technical depth but the summary   │
│               │  section undersells leadership scope. Consider…             │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Esc: abort stream  ·  second Esc: back to menu                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

After streaming completes:

```
│               │  [ Back to refine menu ]   [ Generate resume ]              │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Enter: choose action  ·  Esc: back to refine menu                           │
```

### Refine — direct edit (free-form instructions)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  direct edit                                       │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 3 Refine    │  Apply direct edit                                          │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Describe what to change:                                   │
│               │  ┌──────────────────────────────────────────────────────┐  │
│               │  │ Strengthen the payments infrastructure bullet at     │  │
│               │  │ Acme to emphasize the scale (10M tx/day)…            │  │
│               │  └──────────────────────────────────────────────────────┘  │
│               │  1,180 chars  ·  Ctrl+D: submit  ·  Esc: cancel           │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Multiline: Enter = newline  ·  q does NOT quit                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Refine — prepare for a saved job

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  prepare                                           │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 3 Refine    │  Prepare for a job                                          │
│   …           │  Select a saved job to curate against:                      │
│               │  ────────────────────────────────────────────────────────    │
│               │  ► arize-sr-platform      [not yet curated]                │
│               │    acme-staff-eng         [curated ✓]                      │
│               │    old-co-contractor      [curated ✓]                      │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter start  ·  Esc back                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Then runs curation inline (spinner → streaming → summary → action row), never dropping to CLI.

### Generate — JD source selection

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  generate                                          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   3 Refine    │  Generate tailored resume                                   │
│ ► 4 Generate  │  Where is the job description?                              │
│   5 Jobs      │  ────────────────────────────────────────────────────────    │
│   …           │  ► Paste a job description                                  │
│               │    Use a saved job                                          │
│               │    No job description (generic tailoring)                   │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter confirm  ·  Esc back                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Generate — paste JD

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  generate                                          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 4 Generate  │  Paste job description                                      │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  ┌──────────────────────────────────────────────────────┐  │
│               │  │ About the role                                       │  │
│               │  │ We are hiring a Staff Engineer to own…               │  │
│               │  │ …                                                    │  │
│               │  └──────────────────────────────────────────────────────┘  │
│               │  1,240 chars  ·  Ctrl+D: done  ·  Esc: back               │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Multiline: Enter = newline  ·  q does NOT quit                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Generate — template + flair configuration

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  generate                                          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 4 Generate  │  Configure resume                                           │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Template                                                    │
│               │  ► Classic (ATS-safe, serif)                               │
│               │    Modern (two-column header)                               │
│               │    Bold (full sidebar)                                      │
│               │    Retro (typographic)                                      │
│               │    Timeline (visual, with logos)                            │
│               │                                                              │
│               │  Flair  [ ████░ ]  3 / 5  (← → to adjust)                 │
│               │                                                              │
│               │  [ Generate → ]                                             │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ template  ·  ←→ flair  ·  Enter start  ·  Esc back                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Generate — pipeline in progress

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  generating…                                       │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   3 Refine    │  Generate tailored resume                                   │
│ ► 4 Generate  │  ● JD ──● Analyze ──● Curate ──○ Polish ──○ Consult ──○ PDF│
│   5 Jobs      │  ────────────────────────────────────────────────────────    │
│   …           │  Step 3/6: Curating sections for Senior Platform Engineer   │
│               │                                                              │
│               │  ⠋ Selecting positions, skills, and education…              │
│               │                                                              │
│               │  (streaming text appears here as model responds)            │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Esc: abort step  ·  navigation locked                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Generate — curation preview (confirm before polish)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  review curation                                   │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 4 Generate  │  Curated selections                                         │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Positions (4)                                               │
│               │    ✓ Staff Engineer @ Acme (2021–present)  — 3 bullets      │
│               │    ✓ Senior Engineer @ Acme (2019–2021)    — 2 bullets      │
│               │    ✓ Engineer @ OldCo (2016–2019)          — 2 bullets      │
│               │    ✗ Intern @ StartupX (2015–2016)  [excluded]             │
│               │  Skills (12 of 20 selected)                                 │
│               │  Education (2)                                               │
│               │                                                              │
│               │  ► Continue to polish                                       │
│               │    Rerun curation                                           │
│               │    Edit selections manually                                 │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter confirm  ·  Esc back                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Generate — done

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith                                                        │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 4 Generate  │  Resume ready                                               │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  output/resumes/Jane_Smith_Arize_Sr_Platform_Mar_2026.pdf  │
│               │                                                              │
│               │    Template: Modern  ·  Flair: 3  ·  Fit: 98%             │
│               │                                                              │
│               │  ► Generate another (same job)                              │
│               │    Change template / flair                                  │
│               │    Generate for a different job                             │
│               │    Back to Dashboard                                        │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter confirm  ·  Esc back                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Jobs — two-panel (≥80 cols) / stacked (<80 cols)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  4 jobs                                            │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   4 Generate  │  Saved jobs               │  Arize · Sr Platform Engineer   │
│ ► 5 Jobs      │  ─────────────────────    │  ──────────────────────────     │
│   6 Profile   │  ► arize-sr-platform [✓]  │  Saved: Mar 10, 2026           │
│   …           │    acme-staff-eng  [draft] │  PDF: ✓ generated              │
│               │    old-co-contract [✓]    │                                 │
│               │                           │  JD preview (↑↓ to scroll)      │
│               │  a: Add  d: Delete        │  We are looking for a seasoned  │
│               │  g: Generate  p: Prepare  │  engineer to own…               │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Tab: sidebar ↔ list ↔ detail  ·  ↑↓ select  ·  Enter view full JD  ·  q quit│
└──────────────────────────────────────────────────────────────────────────────┘
```

Jobs actions (`a`, `d`, `g`, `p`) all stay inside the TUI — no breakout:
- **`a`** → inline `<MultilineInput>` for job title + company + JD paste, then save
- **`d`** → inline `<ConfirmPrompt>` "Delete arize-sr-platform? (Enter/n)"
- **`g`** → navigate to GenerateScreen with job pre-selected
- **`p`** → run curation inline (spinner → summary → action row)

### Profile editor — section list

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  profile                                           │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   5 Jobs      │  Profile  >  (section)                                      │
│ ► 6 Profile   │  ────────────────────────────────────────────────────────    │
│   7 Contact   │    Summary                                                   │
│   …           │  ► Experience                                               │
│               │    Skills                                                    │
│               │    Education                                                 │
│               │    Certifications                                            │
│               │    Projects                                                  │
│               │    Contact (→ screen 7)                                      │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ↑↓ choose  ·  Enter open  ·  Esc back to sidebar                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Profile editor — bullets

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  profile                                           │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 6 Profile   │  Profile  >  Experience  >  Acme  >  bullets                │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Staff Engineer @ Acme Corp  (2021 – present)               │
│               │                                                              │
│               │    1. Led migration from monolith to microservices…         │
│               │  ► 2. Reduced payments latency by 40%                       │
│               │    3. Grew platform team from 5 to 12 engineers             │
│               │                                                              │
│               │  Enter: edit  ·  a: add bullet  ·  d: delete  ·  ↑↓ move   │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Esc: up one level  ·  s: save                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

Pressing Enter on a bullet opens `<InlineEditor>` pre-filled with the bullet text. Save on Enter; discard on Esc. No `$EDITOR` spawn — all editing stays in Ink.

### Contact

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  contact                                           │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   6 Profile   │  Contact info                                               │
│ ► 7 Contact   │  ────────────────────────────────────────────────────────    │
│   8 Settings  │  Name       [ Jane Smith_______________________________ ]   │
│               │  Email      [ jane@example.com_________________________ ]   │
│               │  Phone      [ +1 555-555-5555_________________________ ]   │
│               │  Location   [ San Francisco, CA______________________ ]   │
│               │  LinkedIn   [ linkedin.com/in/janesmith______________ ]   │
│               │  Website    [ https://jane.dev________________________ ]   │
│               │  GitHub     [ github.com/janesmith__________________ ]   │
│               │                                                              │
│               │  [ Save all ]     last saved: Mar 18 09:41                 │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Tab: advance field  ·  Enter: save + advance  ·  s: Save all  ·  Esc: back │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Settings

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  settings                                                         │
├───────────────┬──────────────────────────────────────────────────────────────┤
│   7 Contact   │  Settings                                                   │
│ ► 8 Settings  │  ────────────────────────────────────────────────────────    │
│               │  API key      [ sk-ant-api03-•••••••••••••••••••••••••• ]  │
│               │  Provider     ► Anthropic  /  OpenRouter                   │
│               │  Output dir   [ ./output________________________________ ]  │
│               │  Default flair [ 3 ▼ ]                                      │
│               │  [ ] Headed browser default                                 │
│               │                                                              │
│               │  [ Save to .env ]                                           │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Tab: advance  ·  Enter: toggle/edit  ·  s: Save to .env  ·  Esc: back      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Error + retry (generic)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Suited  ·  Jane Smith  ·  import                                            │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ► 2 Import    │  Import failed                                              │
│   …           │  ────────────────────────────────────────────────────────    │
│               │  Timeout waiting for LinkedIn page.                         │
│               │  net::ERR_TIMED_OUT at linkedin.com/in/janesmith           │
│               │                                                              │
│               │  ► Retry (same URL)                                         │
│               │    Edit URL                                                 │
│               │    Back to Dashboard                                        │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ Enter: choose  ·  Esc: back to input                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

