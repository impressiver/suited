# Contributing

Thanks for helping improve suited.

## Prerequisites

- **Node.js** ≥ 20.12 (see `package.json` `engines`)
- **pnpm** 9.x (lockfile is `pnpm-lock.yaml`)

## Setup

```bash
pnpm install
pnpm test && pnpm build   # same as `pnpm ci` (what GitHub Actions runs)
pnpm check                # Biome on src/ + scripts/ (see note below)
```

**Biome:** CI runs **`pnpm ci`** (tests + compile) only. The repo still has historical Biome findings outside new work — before you push, run `pnpm exec biome check` on **files you changed** and fix new issues. Goal is to converge the whole tree to `pnpm check` over time.

Run the CLI without a full build:

```bash
pnpm dev
pnpm dev import --help
```

## Pull requests

1. **Branch** from `main` with a short descriptive name.
2. **Run checks** before pushing: `pnpm check && pnpm test && pnpm build`.
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
