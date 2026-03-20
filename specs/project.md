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
- **Clear pipeline** — Import → refine → (optional) jobs → prepare → generate MUST remain conceptually separable; interactive UI MUST route into the same command logic as non-interactive use where applicable.
- **Explicit AI use** — Calls to Anthropic or compatible APIs MUST be driven by user configuration (API keys in env / `.env`); the tool MUST NOT phone home with resume content for analytics by default (see [`SECURITY.md`](../SECURITY.md) if that ever changes).

---

## 3. Non-goals

- suited is **not** a hosted SaaS or multi-tenant product in this repo’s scope.
- **LinkedIn automation** exists only to support user-owned import; users MUST comply with LinkedIn’s terms (see user-facing notes in [`README.md`](../README.md)).
- A **full-screen Ink TUI** is specified separately; it is a **UI shell** replacement for the interactive dashboard, not a second pipeline ([`tui-README.md`](./tui-README.md)).

---

## 4. Pipeline (happy path)

Order of stages:

1. **Import** — Ingest LinkedIn URL, export ZIP/CSV, or paste → produces structured **source** material under the profile dir (e.g. `source.json`).
2. **Refine** — Q&A and structured edits → **refined** profile (`refined.json`, `refined.md`).
3. **Jobs** — User stores **job descriptions** (files / metadata under the profile dir).
4. **Prepare** — Curate the profile **for one saved job** (selection + feedback) before PDF.
5. **Generate** — Assemble resume + template → **PDF** using job-aware curation.

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

- Global refined profile (`refined.md` / `refined.json`) — editable by the user.
- Per-job curated copies under `jobs/{job-slug}/` — editable; subsequent runs SHOULD detect changes and offer reload vs re-curation as implemented in commands.

Exact filenames and migration rules live in code and user docs; **behavioral** expectation: **no silent overwrite** of user-edited files without confirmation where the CLI already implements that pattern.

---

## 8. Interactive UI

- **Today:** Default `suited` with no subcommand runs **`runDashboard`** (terminal menus via `inquirer` and related patterns). See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
- **Future:** Full-screen TUI (Ink/React) is specified in [`tui-README.md`](./tui-README.md) and `tui-*.md`. Core business logic MUST remain in **`generate/`**, **`profile/`**, **`claude/`**, **`ingestion/`**, and shared services — not duplicated inside UI-only code (see TUI spec for forbidden imports and phasing).

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
| [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | Module map, data flow, dashboard vs TUI |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Dev workflow, PR expectations |
| [`SECURITY.md`](../SECURITY.md) | Reporting, dependency policy |
| [`AGENTS.md`](./AGENTS.md) | Agent/human routing: streams, deps, PR discipline |
| [`tui-README.md`](./tui-README.md) | Future TUI (phasing, screens, testing) |

---

## 11. Open evolution

Behavior not locked here defers to **issue/PR discussion** and updates to the documents above. When a change affects user-visible guarantees (accuracy, privacy, or default paths), **README** and this spec SHOULD stay aligned.
