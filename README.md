# resume-builder

A CLI tool that ingests LinkedIn profile data, refines it with Claude, and generates tailored, factually-accurate PDF resumes.

**Core guarantee:** every word in the output is traceable to your input data. Claude can only *select* existing profile items by reference ID — it cannot invent, paraphrase, or embellish anything.

## Features

- Import from a LinkedIn profile URL (Puppeteer scraper with session persistence), data export (ZIP or CSV directory), or pasted profile text
- Claude-powered refinement: targeted Q&A to fill gaps and sharpen weak bullets before generating
- Human-editable `refined.md` with full round-trip parsing
- Optional job description targeting: Claude curates and selects the most relevant items
- Accuracy guard: all curation references are validated against the source profile before assembly
- Three visual templates (classic / modern / bold) with five flair levels
- PDF output via Puppeteer

## Requirements

- Node.js 20+
- An API key from [Anthropic](https://console.anthropic.com/) **or** [OpenRouter](https://openrouter.ai/)

## Setup

```bash
pnpm install
pnpm exec puppeteer browsers install chrome
cp .env.example .env
# Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env
pnpm build
```

## Usage

### Full pipeline (recommended)

```bash
node dist/index.js
```

Runs the three-step flow interactively. Each step is skipped if its output already exists and the upstream data has not changed.

```
=== Resume Builder ===

Step 1 of 3 — Import
  Found: Ian White (imported 3/15/2026)
  ❯ Use existing
    Import new data

Step 2 of 3 — Refine
  Refinement already complete (3/15/2026)
  ❯ Skip — use existing refinement
    Edit refined.md manually
    Re-run refinement with Claude

Step 3 of 3 — Generate
  Previous generation: Acme Corp — Software Engineer (3/15/2026, flair 3)
  Use the same settings? (Y/n)
```

### Individual commands

```bash
node dist/index.js import    # Phase 1: import LinkedIn data
node dist/index.js refine    # Phase 2: Claude Q&A refinement
node dist/index.js generate  # Phase 3: generate PDF
node dist/index.js validate  # Check profile integrity
```

## The three phases

### Phase 1 — Import → `output/source.json`

Pulls in your raw LinkedIn data verbatim. Supports:

```bash
# From a LinkedIn profile URL (Puppeteer scraper)
node dist/index.js import https://www.linkedin.com/in/your-username

# Show browser window (required for 2FA or CAPTCHA)
node dist/index.js import https://www.linkedin.com/in/your-username --headed

# Clear saved session and re-authenticate
node dist/index.js import https://www.linkedin.com/in/your-username --clear-session

# From a LinkedIn data export ZIP
node dist/index.js import ~/Downloads/linkedin-export.zip

# From a CSV export directory
node dist/index.js import ~/Downloads/Basic_LinkedInDataExport/

# From pasted text (prompts for input)
node dist/index.js import
```

When importing via URL, the scraper launches Chrome, prompts for your LinkedIn credentials on first run, and saves the session to `~/.resume-builder/linkedin-session.json`. Only `linkedin.com` cookies are persisted.

> **Note:** This tool is intended for importing your own LinkedIn profile data. LinkedIn's Terms of Service prohibit automated scraping of their platform.

### Phase 2 — Refine → `output/refined.json`

Claude analyzes your source data and asks 3–8 targeted questions to improve weak or missing bullets (e.g. "Can you quantify the impact of that migration?"). You answer in the terminal; Claude generates improved bullets from your answers. A before/after diff is shown before anything is saved.

Skipped automatically if `refined.json` already exists and `source.json` has not changed since the last run. If source data changes, the refinement is cleared and must be re-run.

Edit `output/refined.md` manually at any time — changes are detected on next run.

### Phase 3 — Generate → `output/resumes/*.pdf`

Builds the PDF from refined data. Job description is optional:

- **With JD:** Claude analyzes the role and selects the most relevant positions, bullets, skills, and education. Accuracy guard validates every selection.
- **Without JD:** generates a complete resume from all refined data.

Settings (flair, template, JD) are saved to `output/generation.json` and reused on the next run. If the refined profile has changed, saved settings are discarded automatically.

## Data flow and invalidation

```
source.json  →  refined.json  →  generation.json  →  PDF
```

| Change | Effect |
|--------|--------|
| Re-import with new data | `refined.json` and `generation.json` cleared |
| Profile edited in `refined.md` or refine re-run | `generation.json` discarded |
| Re-generate with same settings | Uses saved `generation.json`, no prompts |

## How the accuracy system works

When curating for a job, all profile bullets are serialized into a reference list with stable IDs (`b:pos-0:2`, `b:pos-1:0`, etc.). Claude's prompt instructs it to select *only* from this list by ID. After Claude responds:

1. Every bullet ref is checked to exist in the ref map
2. Every ref's `kind` is verified (a bullet ref cannot be used as a summary)
3. Bullet refs are checked to belong to the claimed position (cross-position assignment is rejected)
4. Resolved values are compared against stored values

If any check fails, the pipeline halts before any PDF is generated.

## Templates

| Flair | Template | Style |
|-------|----------|-------|
| 1–2 | classic | Single column, serif, ATS-safe |
| 3–4 | modern | Two-column header, accent color, sans-serif |
| 5 | bold | Full sidebar, color block header |

Academia, healthcare, and legal roles always use the classic template regardless of flair selection.

## Project structure

```
src/
  commands/         # CLI command handlers (flow, import, refine, generate, validate)
  claude/           # SDK wrapper, accuracy guard, prompts
  generate/         # Job analysis, curation, resume assembly, rendering
  ingestion/        # LinkedIn scraper, export parser, paste parser, normalizer
  pdf/              # Puppeteer PDF export
  profile/          # Schema (Zod), serializer, markdown roundtrip
  templates/        # Eta HTML templates + CSS (classic, modern, bold)
  utils/            # fs, zip, interactive helpers
output/             # Generated files (git-ignored)
  source.json       # Phase 1 output: raw LinkedIn data
  source.md
  refined.json      # Phase 2 output: Claude-refined data
  refined.md
  generation.json   # Phase 3 output: saved generation settings
  resumes/
```

## Development

```bash
pnpm dev            # Run full pipeline without building
pnpm dev import     # Run a specific command without building
pnpm build          # Compile TypeScript → dist/
```
