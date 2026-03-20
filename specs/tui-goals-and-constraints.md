# Goals, non-goals, breakout rule & services

## Goals

- **Zero breakout (Phase C)** — After the TUI launches, the user never sees a raw Inquirer prompt, chalk banner, or bare `console.log` output from command drivers. Every interaction stays in the Ink render tree. *(Phase A may temporarily delegate; see [Phased delivery](./tui-phased-delivery.md).)*
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

| File | Source | Key exports + signatures |
|------|--------|--------------------------|
| `src/services/refine.ts` | `commands/refine.ts` | See below |
| `src/services/improve.ts` | `commands/improve.ts` | `computeHealthScore(profile: Profile): HealthScore` |
| `src/services/validate.ts` | `commands/validate.ts` | `validateProfile(profile: Profile): ValidationResult` |
| `src/services/contact.ts` | `commands/contact.ts`, `utils/contact.ts` | `mergeContactMeta(fields: ContactFields, profileDir: string): Promise<void>` |

**`src/services/refine.ts` key signatures:**

```typescript
// Generate targeted questions for the profile (calls Claude)
generateRefinementQuestions(
  profile: Profile,
  signal?: AbortSignal
): Promise<RefinementQuestion[]>

// Apply user answers to produce a refined profile (calls Claude)
applyRefinements(
  profile: Profile,
  answers: Record<string, string>,
  signal?: AbortSignal
): Promise<RefinedProfile>

// Compute diff blocks between original and refined (pure, no I/O)
// NOTE: this function does not exist yet — it must be designed as part of
// the service extraction, by refactoring the inline diff logic in
// reviewRefinements() in commands/refine.ts
computeRefinementDiff(
  original: Profile,
  refined: Profile
): DiffBlock[]

// Polish selected sections (calls Claude, streaming)
polishProfile(
  profile: Profile,
  opts: { sections: string[]; positionIds?: string[] },
  signal?: AbortSignal
): AsyncGenerator<StreamEvent | { type: 'done'; result: Profile }>

// Apply free-form edit instructions (calls Claude, streaming)
applyDirectEdit(
  profile: Profile,
  instructions: string,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent | { type: 'done'; result: Profile }>
```

**Error contract:** All service functions **MUST** throw typed errors (or return `Result<T, AppError>`). Plain `Error` throws are acceptable for Phase B; typed errors are a Phase C refinement. TUI screens catch and map to the `error` state.

**`computeRefinementDiff` note:** This function does not exist in the codebase today. It requires refactoring the inline diff-generation logic from `reviewRefinements()` in `commands/refine.ts` into a pure function that takes two Profile objects and returns `DiffBlock[]`. This is new design work, not a simple extraction.

**`mergeContactMeta` contract:** Takes the edited contact field values + `profileDir`, determines which profile file is active (refined > source), writes the contact fields into that profile, and writes `contact.json`. Does **not** call inquirer.

Commands **refactor** to delegate to services; CLI behavior stays the same at the user-visible level.

### Coverage: validate, improve, prepare, --jd flag

The existing `validate`, `improve`, and `prepare` subcommands are mapped as follows in the TUI:

| Subcommand | TUI coverage |
|------------|-------------|
| `suited validate` | **Dashboard** shows validation status derived from `validateProfile()`. No standalone screen. |
| `suited improve` | Health score from `computeHealthScore()` shown on Dashboard in `refined` state. Improvement actions are the Refine sub-menu options. No standalone screen. |
| `suited prepare` | Subsumed by "Prepare for a saved job" in RefineScreen and JobsScreen. No standalone PrepareScreen needed. |
| `suited generate --jd <path>` | **CLI-only** (non-interactive use case). Not replicated in TUI. The JD source picker covers all TUI use cases. |
| `suited generate --all-templates` | **CLI-only**. Not replicated in TUI. |

### Risk & rollback (SHOULD)

- **Before** large extractions: add or extend **tests** for CLI flows (fixtures, golden stderr/stdout if feasible) or a **scripted manual checklist** per command.
- **Rollback criterion:** If CI or QA shows behavior change, revert the extraction PR and re-plan; do not "fix forward" under time pressure without a test gap analysis.
