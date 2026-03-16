# resume-builder

A CLI tool that ingests LinkedIn profile data and uses Claude to generate tailored, factually-accurate PDF resumes.

**Core guarantee:** every word in the output is traceable to your input data. Claude can only *select* existing profile items by reference ID — it cannot invent, paraphrase, or embellish anything.

## Features

- Import from LinkedIn data export (ZIP or CSV directory) or pasted profile text
- Human-editable `profile.md` with full round-trip parsing
- Claude-powered job description analysis and resume curation
- Accuracy guard: all curation references are validated against the source profile before assembly
- Three visual templates (classic / modern / bold) with five flair levels
- PDF output via Puppeteer

## Requirements

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
pnpm install
pnpm exec puppeteer browsers install chrome
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
pnpm build
```

## Usage

### Import a LinkedIn profile

```bash
# From a LinkedIn data export ZIP
node dist/index.js import ~/Downloads/linkedin-export.zip

# From a CSV export directory
node dist/index.js import ~/Downloads/Basic_LinkedInDataExport/

# From pasted text (prompts for input)
node dist/index.js import
```

This writes `output/profile.json` and `output/profile.md`. Edit `profile.md` directly to add, remove, or reword bullets — changes are detected on the next `generate` run.

### Generate a resume

```bash
node dist/index.js generate
```

Interactive flow:
1. Load profile
2. Paste or provide a job description
3. Review Claude's job analysis (override company/title/industry if needed)
4. Select flair level (1–5); industry-appropriate default is pre-selected
5. Review curation summary (positions, skills, education, certs selected)
6. Accuracy check runs automatically
7. PDF written to `output/resumes/{company}-{role}-{date}.pdf`

### Validate profile integrity

```bash
node dist/index.js validate
```

Re-runs the accuracy guard against the current profile to confirm all references resolve correctly.

## How the accuracy system works

When curating, the tool serializes all profile bullets into a reference list with stable IDs (`b:pos-0:2`, `b:pos-1:0`, etc.). Claude's prompt instructs it to select *only* from this list by ID. After Claude responds:

1. Every bullet ref is checked to exist in the ref map
2. Every ref's `kind` is verified (a bullet ref cannot be used as a summary, etc.)
3. Bullet refs are checked to belong to the claimed position (cross-position assignment is rejected)
4. Resolved values are compared against stored values

If any check fails, the pipeline halts with a detailed error before any PDF is generated.

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
  commands/         # CLI command handlers (import, generate, validate)
  claude/           # SDK wrapper, accuracy guard, prompts
  generate/         # Job analysis, curation, resume assembly, rendering
  ingestion/        # LinkedIn export parser, paste parser, normalizer
  pdf/              # Puppeteer PDF export
  profile/          # Schema (Zod), serializer, markdown roundtrip
  templates/        # Eta HTML templates + CSS (classic, modern, bold)
  utils/            # fs, zip, interactive helpers
output/             # Generated files (git-ignored)
  profile.json
  profile.md
  resumes/
```

## Development

```bash
pnpm dev import         # Run without building
pnpm build              # Compile TypeScript → dist/
```
