# Project specification — suited

This document is the **engineering + product contract** for the **suited** CLI as a whole: scope, pipeline, accuracy rules, and where to find deeper detail. It complements the user-facing [`README.md`](../README.md) and module-oriented [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

**Implementers:** for parallel workstreams, dependency order, and which TUI doc to open per task, see [`AGENTS.md`](./AGENTS.md).

**Normative terms** (MUST / MUST NOT / SHOULD / MAY) follow [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## 1. Product definition

**suited** is a **Node.js CLI** that helps a user turn **source resume data** (typically from LinkedIn) into **job-tailored PDF resumes** with **LLM-assisted** refinement and curation, while **not inventing** facts: output traces to user-provided or user-approved content.

---

## 2. Goals

- **Factual grounding** — Tailored text and PDFs MUST be derived from a **reference map** of profile items with stable IDs; the generation path MUST validate references before export (see §6).
- **Local-first workflow** — Profile data and artifacts live under a **configurable profile directory** (default `output/`); users SHOULD be able to inspect and edit human-readable files (e.g. `refined.md`) between runs.
- **Clear pipeline** — Import → refine → (optional) jobs → prepare → *(optional)* [Curate](./tui-screens.md#curatescreen-planned) *(TUI, planned)* → generate MUST remain conceptually separable; interactive UI MUST route into the same command logic as non-interactive use where applicable.
- **Explicit AI use** — Calls to Anthropic or compatible APIs MUST be driven by user configuration (API keys in env / `.env`); the tool MUST NOT phone home with resume content for analytics by default (see [`SECURITY.md`](../SECURITY.md) if that ever changes).

---

## 3. Non-goals

- suited is **not** a hosted SaaS or multi-tenant product in this repo’s scope.
- **LinkedIn automation** exists only to support user-owned import; users MUST comply with LinkedIn’s terms (see user-facing notes in [`README.md`](../README.md)).
- The **full-screen Ink TUI** (default `suited` in a TTY) is the primary interactive shell; it uses **`src/services/`** and is specified in [`tui-README.md`](./tui-README.md) — not a second pipeline ([`tui-definition-of-done.md`](./tui-definition-of-done.md)).

---

## 4. Pipeline (happy path)

Order of stages:

1. **Import** — Ingest LinkedIn URL, export ZIP/CSV, or paste → produces structured **source** material under the profile dir (e.g. `source.json`).
2. **Refine** — Q&A and structured edits → **refined** profile (`refined.json`, `refined.md`).
3. **Jobs** — User stores **job descriptions** (files / metadata under the profile dir).
4. **Prepare** — Curate the profile **for one saved job** (selection + feedback) before PDF — produces a **curation plan** (what to include).
5. **Curate** *(TUI — planned)* — Optional **main-menu** step **after prepare** (or in parallel with revisiting a job): **iterate job-scoped refined content** (polish, consultant, manual edits, direct edit) with **per-job persistence**, distinct from global **Refine**. See [`tui-screens.md` — CurateScreen](./tui-screens.md#curatescreen-planned).
6. **Generate** — Assemble resume + template → **PDF** using job-aware curation (and any job-scoped curated profile on disk).

**Templates vs flair (orthogonal):** A **template** is the **baseline layout** (structure, typography family, overall pattern). A **flair level** (e.g. 1–5) is chosen **independently** for that template. Flair sets how much **creative freedom** the layout / “designer” side of generation may take when interpreting the baseline: lower flair stays close to the template’s default look; higher flair allows more **artistic license** and run-to-run **variety** in styling and presentation while content remains reference-grounded (see §6). Flair is not a proxy for “which template” — it is a dial on how far an agent may depart from the baseline for a given template.

**Validate** checks integrity; **improve** is an interactive maintenance hub (re-refine, bullets, summary, contact) without replacing the core refine contract.

Detailed command behavior and flags: [`README.md`](../README.md). Code layout: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

---

## 5. Commands (surface area)

The CLI MUST expose the subcommands documented in [`README.md`](../README.md), including at minimum: default flow (`suited`), `import`, `refine`, `improve`, `jobs`, `prepare`, `generate`, `validate`. Exact options evolve in `src/index.ts` and `src/commands/*`; **this spec does not duplicate every flag** — the README and `--help` are the user-facing source of truth for options.

---

## 6. Accuracy model (generation)

For job-tailored output, the pipeline MUST:

- Build a **reference map** of profile items with **stable IDs**.
- Constrain LLM usage so selection and assembly **only reference** those IDs (no free-form invention of employers, dates, or bullets).
- **Validate** before PDF export: IDs exist, types match intended roles, bullets belong to claimed positions, resolved text matches stored content.

If validation fails, the pipeline MUST NOT emit a PDF for that run until the inconsistency is resolved.

---

## 7. Profile directory layout (conceptual)

The tool MUST support `--profile-dir` so multiple profiles can coexist. Within a profile, artifacts include (non-exhaustive):

- Global refined profile (`refined.md` / `refined.json`) — editable by the user. **Planned:** durable **refinement history** under a **separate** top-level directory (e.g. **`refined-history/`**, not under `refinements/`) and **revert** to older refined states without relying on Git — see [`refinement-history.md`](./refinement-history.md).
- Per-job curated copies under `jobs/{job-slug}/` — editable; subsequent runs SHOULD detect changes and offer reload vs re-curation as implemented in commands.
- Per-job refinement JSON under `refinements/{jobId}.json` — stores the curation plan plus optional **`pinnedRender`**: the last successful **layout squeeze** tier (and resolved template / flair metadata) so the next generate for the same job, with the same flair and template override, can reuse the same CSS fit-override path for repeatable PDF layout. Re-prepare / re-curate SHOULD preserve `pinnedRender` until a successful export overwrites it. When the user **clears job-scoped curated content** (e.g. Curate **Clear and start over**), implementation SHOULD **clear or invalidate `pinnedRender`** for that `jobId` so the next export does not reuse a squeeze tier tied to discarded layout length; the next successful PDF export may write a fresh `pinnedRender`.

Exact filenames and migration rules live in code and user docs; **behavioral** expectation: **no silent overwrite** of user-edited files without confirmation where the CLI already implements that pattern.

**Global directories (outside the profile tree):** Machine-local state uses **XDG Base Directory** conventions on Linux and macOS: **config** at `$XDG_CONFIG_HOME/suited` (default `~/.config/suited`), **cache** at `$XDG_CACHE_HOME/suited` (default `~/.cache/suited`). The config directory holds the LinkedIn URL import session (`linkedin-session.json`) and **global** `contact.json` (user-entered headline, email, phone, LinkedIn, etc.—one file shared across all `--profile-dir` values). The cache directory holds `logo-cache.json` (resolved employer logo data URIs). On Windows, config maps to `%APPDATA%\suited` and cache to `%LOCALAPPDATA%\suited\cache`. Legacy `~/.suited/` is still read for LinkedIn session migration; legacy `contact.json` / `logo-cache.json` under a profile directory are read and removed after migration to the global paths.

**PDF output:** Unless overridden with `suited generate --output <dir>`, PDFs MUST default to a **`resumes/`** directory **relative to `process.cwd()`** at generate time (with existing job-slug subdirectories as implemented), not under `--profile-dir`.

---

## 8. Interactive UI

- **Default entry (`suited` with no subcommand):** In an **interactive TTY** (stdin + stdout TTY), the process runs the **full-screen Ink TUI** (`runFlow` → `runTui`). In a **non-TTY** environment, it **MUST NOT** block on input — it prints a **one-line** hint to stderr and exits (canonical behavior in [`tui-README.md`](./tui-README.md)). **Subcommands** (`suited generate`, `suited refine`, …) use their own interactive or non-interactive paths (some still use **inquirer** where documented); they MUST call **`src/services/`** for shared behavior, not duplicate pipeline logic in UI-only code.
- **TUI contract:** [`tui-README.md`](./tui-README.md) and `tui-*.md`. A planned **Curate** sidebar row covers **per-job** polish/consultant/edit flows ([CurateScreen](./tui-screens.md#curatescreen-planned)). Core business logic MUST remain in **`generate/`**, **`profile/`**, **`claude/`**, **`ingestion/`**, and shared services — not inside `src/tui/**` except as wiring (see TUI spec for forbidden imports).

---

## 9. Build and distribution

- **Runtime:** Node.js **≥ 20.12** (see [`package.json`](../package.json)).
- **Build:** TypeScript → `dist/`, templates copied alongside; optional **single-file binary** via project scripts (`pnpm build`, `pnpm build:binary`).
- **Quality bar:** Lint/format (Biome), unit tests (Vitest), CI expectations as defined in repo scripts and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## 10. Related documents

| Document | Role |
|----------|------|
| [`README.md`](../README.md) | Installation, usage, templates, accuracy guarantee (user-facing) |
| [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | Module map, data flow, TUI vs CLI subcommands |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Dev workflow, PR expectations |
| [`SECURITY.md`](../SECURITY.md) | Reporting, dependency policy |
| [`AGENTS.md`](./AGENTS.md) | Agent/human routing: streams, deps, PR discipline |
| [`tui-README.md`](./tui-README.md) | TUI index (screens, testing, non-TTY, phasing) |
| [`tui-definition-of-done.md`](./tui-definition-of-done.md) | Phase A/B/C + post–C polish |
| [`refinement-history.md`](./refinement-history.md) | **Planned:** snapshots + restore for global refined profile |

---

## 11. Open evolution

Behavior not locked here defers to **issue/PR discussion** and updates to the documents above. When a change affects user-visible guarantees (accuracy, privacy, or default paths), **README** and this spec SHOULD stay aligned.
