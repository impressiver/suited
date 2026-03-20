# Contributing

Thanks for helping improve suited.

## Prerequisites

- **Node.js** ≥ 20.12 (see `package.json` `engines`)
- **pnpm** 9.x (lockfile is `pnpm-lock.yaml`)

## Setup

```bash
pnpm install
pnpm run ci               # tests + check:tui-imports + template em-dash gate + build (recommended before push)
pnpm check                # Biome on src/ + scripts/ (see note below)
```

`package.json` **`ci`** script runs `pnpm test`, **`pnpm check:tui-imports`** (TUI must not import `commands/` or Inquirer), the same **template em-dash** check as **`pnpm lint`** (`scripts/check-templates-no-em-dash.mjs`), and **`pnpm build`**. Use `pnpm run ci` (not the built-in `pnpm ci`, which is different).

**Biome:** CI runs **`pnpm ci`** (tests + compile) only. The repo still has historical Biome findings outside new work — before you push, run `pnpm exec biome check` on **files you changed** and fix new issues. Goal is to converge the whole tree to `pnpm check` over time.

Run the CLI without a full build:

```bash
pnpm dev
pnpm dev import --help
```

## Pull requests

1. **Branch** from `main` with a short descriptive name.
2. **Run checks** before pushing: `pnpm run ci` (or `pnpm test && pnpm build` if you skip the TUI import gate locally — CI expects the full script).
3. **Describe** what changed and why (user-visible behavior, risks, or follow-ups).

### Commits

Conventional-style messages help the release script classify bumps (`feat:`, `fix:`, `BREAKING CHANGE`, etc.). See `scripts/version.mjs` for rules.

## Code style

- **Biome** is the source of truth (`biome.json`). Use `pnpm format` to apply.
- Match existing patterns: TypeScript **strict**, **relative** imports use **`.ts` / `.tsx`** (matches source files; `tsc` rewrites to `.js` in `dist/`). Biome **`useImportExtensions`** enforces this—run `pnpm lint` on touched files. Published package paths (e.g. `…/messages.js`) stay as the package ships them. Business logic outside `src/commands/` where possible.

## Adding tests

- Place tests next to code: `src/**/*.test.ts`.
- Prefer **fast, deterministic** unit tests (pure helpers, parsers). Integration tests that call the network or Chrome are optional and should be clearly marked or skipped in CI.

## Documentation

- User-facing behavior → `README.md`.
- Structure and module boundaries → `docs/ARCHITECTURE.md`.
- TUI contracts, phases, and checklists → `specs/tui-README.md`, `specs/tui-definition-of-done.md`, and other `specs/tui-*.md`.
