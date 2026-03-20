# Goals, non-goals, breakout rule & services

## Goals

- **Zero breakout (Phase C)** — After the TUI launches, the user never sees a raw Inquirer prompt, chalk banner, or bare `console.log` output from command drivers. Every interaction stays in the Ink render tree. *(Phase A may temporarily delegate; see [Phased delivery](./phased-delivery.md).)*
- **Complete coverage (Phase C)** — Every flow reachable via subcommands is reachable inside the TUI with equivalent outcomes.
- **Keyboard-first** — Every flow completable without a mouse; keys behave predictably per mode (navigation vs text vs async).
- **Pipeline legible** — User always sees where they are in Import → Refine → Generate.
- **Honest state** — No fake badges or optimistic indicators; reflect actual files and outcomes.
- **CLI parity** — Anything doable in the TUI remains doable via subcommands for scripts and CI.
- **Boring reliability** — Non-TTY never hangs; wide/narrow terminals degrade layout, not semantics.

## Non-goals (v1)

- Mouse support, true color as a requirement, or pixel-perfect layout across all terminals.
- Persisting TUI-specific session state beyond what the existing app already writes to disk.
- Full i18n (English-first; structure should allow i18n later).

---

## The breakout problem

**Central constraint:** Current `src/commands/` files mix business logic with I/O (`console.log`, `inquirer`, `ora`, …). Calling `runRefine()`, `runImport()`, etc. from inside Ink **breaks out** of the TUI.

**Phase C rule:** TUI screen components **MUST NOT** import or call **`src/commands/**`** entrypoints. They call:

- `src/profile/`, `src/generate/`, `src/claude/`, `src/ingestion/`, `src/pdf/` as appropriate
- **`src/services/`** for logic extracted from commands

Any function that today uses `inquirer`, raw `console.log` for UX, `chalk`, `ora`, or interactive `open` as part of the command flow is **off limits** to TUI screens until refactored into services.

---

## Service extraction

Logic buried in command files **SHOULD** move to pure functions under `src/services/` so both CLI and TUI call the same code.

### Callable today (no extraction)

| Module | Examples |
|--------|----------|
| `profile/serializer.ts` | `loadSource`, `loadRefined`, `saveRefined`, `loadJobs`, … |
| `profile/markdown.ts` | `profileToMarkdown`, `markdownToProfile` |
| `generate/*`, `pdf/exporter.ts`, `ingestion/*`, `claude/client.ts` | As in the main spec tables |

### New service files (target)

| File | Source | Exposes (examples) |
|------|--------|---------------------|
| `src/services/refine.ts` | `commands/refine.ts` | `generateRefinementQuestions`, `applyRefinements`, `computeRefinementDiff`, … |
| `src/services/improve.ts` | `commands/improve.ts` | `computeHealthScore`, … |
| `src/services/validate.ts` | `commands/validate.ts` | `validateProfile` |
| `src/services/contact.ts` | `commands/contact.ts`, `utils/contact.ts` | `mergeContactMeta`, … |

Commands **refactor** to delegate to services; CLI behavior stays the same at the user-visible level.

### Risk & rollback (SHOULD)

- **Before** large extractions: add or extend **tests** for CLI flows (fixtures, golden stderr/stdout if feasible) or a **scripted manual checklist** per command.
- **Rollback criterion:** If CI or QA shows behavior change, revert the extraction PR and re-plan; do not “fix forward” under time pressure without a test gap analysis.
