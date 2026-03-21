# Architecture

suited is a **Node.js CLI** (`commander`) that orchestrates **profile data**, **LLM calls**, **optional browser automation** (LinkedIn import), and **PDF export**.

For **product scope, pipeline stages, and accuracy invariants**, see [`specs/project.md`](../specs/project.md). For **implementer workstreams** (CLI vs TUI vs services), see [`specs/AGENTS.md`](../specs/AGENTS.md).

## Entry and commands

| Layer | Role |
|--------|------|
| `src/index.ts` | CLI definition, `--profile-dir` and per-command options, loads `dotenv` |
| `src/commands/flow.ts` | Default action: TTY → **`runTui`** (`src/tui/runTui.tsx`); non-TTY → one-line stderr (no hang) |
| `src/commands/*` | Subcommands (`import`, `refine`, …); **Inquirer** prompts for CLI-only interactive paths |
| `src/tui/**` | Ink/React full-screen app: screens, layout, store, shared components (**MUST NOT** import `commands/` — see `pnpm check:tui-imports`) |
| `src/services/**` | Shared pipeline modules used by **both** TUI and CLI (`refine`, `generateResume`, `importProfile`, …) |

Running **`suited` with no subcommand** invokes **`runFlow`** → **`runTui`** when stdin and stdout are TTYs. Legacy **`runDashboard`** (`src/commands/dashboard.ts`) remains in the tree for reference but is **not** the default entry path.

## Data flow (happy path)

1. **Import** (`ingestion/`, `commands/import.ts`) — Produces **`source.json`** (and related) under the profile directory (default `output/`).
2. **Refine** (`commands/refine.ts`, `claude/prompts/refine.ts`) — Q&A and structured edits → **`refined.json`** + **`refined.md`** (human-editable).
3. **Jobs** — Saved job descriptions under the profile dir.
4. **Prepare** (`commands/prepare.ts`) — Curate the profile **for one saved job** (selection + feedback).
5. **Generate** (`commands/generate.ts`, `generate/`, `pdf/`) — Job-aware PDF using templates in `src/templates/`. Default PDF directory is **`./resumes`** relative to **`process.cwd()`** (not under `--profile-dir`); global **contact** and **logo** persistence use XDG config/cache via `src/utils/suitedDirs.ts` (see [`specs/project.md`](../specs/project.md) §7).

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
| `src/services/` | Service layer: callable from TUI and from `commands/*` without duplicating pipelines |

## Accuracy model

For tailored output, the pipeline builds a **reference map** of profile items with stable IDs. LLM instructions restrict selection to those IDs; validators run before PDF export (see `README` “Accuracy guarantee”).

## Interactive UI: default TUI vs CLI subcommands

- **Default (`suited` in a TTY):** **Ink TUI** under `src/tui/` — **seven** sidebar screens plus **ProfileEditorScreen** (manual sections) opened from **Refine**; shared **`src/services/`** for import, refine, generate, jobs prepare, etc. Specs: [`specs/tui-README.md`](../specs/tui-README.md), checklists in [`specs/tui-definition-of-done.md`](../specs/tui-definition-of-done.md).
- **Subcommands (`suited refine`, …):** **Inquirer**-based prompts in `src/commands/*`; they call the same services where Phase B+ extraction applies.
- **Legacy:** `src/commands/dashboard.ts` (`runDashboard`) is **not** wired as the default Commander action; keep it only if you still need the old menu for comparison or migration.

**Core logic** remains in `generate/`, `profile/`, `claude/`, `ingestion/`, and **`services/`** — not duplicated inside `src/tui/` beyond UI wiring.

## TypeScript imports (local modules)

Use **`.ts` or `.tsx`** on **relative** specifiers (`./` / `../`). That matches the file on disk; `allowImportingTsExtensions` plus `rewriteRelativeImportExtensions` in `tsconfig.json` emit **`dist/**/*.js`** with **`import "./foo.js"`** so **`node dist/index.js`** works. Extensionless relatives are not used here: plain `tsc` output would stay extensionless and Node ESM would not resolve them. **Biome** (`useImportExtensions`) treats missing or wrong extensions as an error.

## Build artifacts

- `pnpm build` — `tsc` outputs to **`dist/`**; templates are copied to `dist/templates/`.
- `pnpm build:binary` — Single-file binary via esbuild + SEA (`scripts/`).
