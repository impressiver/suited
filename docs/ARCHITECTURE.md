# Architecture

suited is a **Node.js CLI** (`commander`) that orchestrates **profile data**, **LLM calls**, **optional browser automation** (LinkedIn import), and **PDF export**.

## Entry and commands

| Layer | Role |
|--------|------|
| `src/index.ts` | CLI definition, `--profile-dir` and per-command options, loads `dotenv` |
| `src/commands/*` | One file per subcommand; interactive prompts (`inquirer`) live here |

Running **`suited` with no subcommand** invokes `runFlow` → **`runDashboard`** (`src/commands/dashboard.ts`): a menu that routes to import, refine, jobs, prepare, generate, etc.

## Data flow (happy path)

1. **Import** (`ingestion/`, `commands/import.ts`) — Produces **`source.json`** (and related) under the profile directory (default `output/`).
2. **Refine** (`commands/refine.ts`, `claude/prompts/refine.ts`) — Q&A and structured edits → **`refined.json`** + **`refined.md`** (human-editable).
3. **Jobs** — Saved job descriptions under the profile dir.
4. **Prepare** (`commands/prepare.ts`) — Curate the profile **for one saved job** (selection + feedback).
5. **Generate** (`commands/generate.ts`, `generate/`, `pdf/`) — Job-aware PDF using templates in `src/templates/`.

**Validate** checks integrity; **improve** is an interactive hub for ongoing edits, summary, and re-refinement without replacing the core refine pipeline.

## Major directories

| Path | Contents |
|------|-----------|
| `src/profile/` | Schema, serialization, markdown ↔ profile |
| `src/claude/` | Anthropic client, prompts, tool schemas |
| `src/generate/` | Curation, resume assembly, consultant evaluation, trimming |
| `src/pdf/` | HTML → PDF (e.g. Puppeteer) |
| `src/ingestion/` | LinkedIn URL / export detection, scraping |
| `src/utils/` | Shared helpers (colors, fs, spinners, …) |
| `src/templates/` | Eta templates + CSS for PDF layouts |

## Accuracy model

For tailored output, the pipeline builds a **reference map** of profile items with stable IDs. LLM instructions restrict selection to those IDs; validators run before PDF export (see `README` “Accuracy guarantee”).

## Interactive UI: dashboard vs TUI

Today, the default experience is the **inquirer-based dashboard** (`dashboard.ts`).

A **full-screen TUI** (Ink/React) is **specified** in [`specs/tui.md`](../specs/tui.md) as a future replacement for the interactive layer only — **core logic stays** in `generate/`, `profile/`, `claude/`, and `ingestion/`. Until that ships, all behavior above applies to both paths.

## Build artifacts

- `pnpm build` — `tsc` outputs to **`dist/`**; templates are copied to `dist/templates/`.
- `pnpm build:binary` — Single-file binary via esbuild + SEA (`scripts/`).
