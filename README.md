# suited

> **Note: This project has not yet been published to npm or Homebrew.**

A CLI tool that generates factually-accurate PDF resumes from source data (eg. LinkedIn profile) tailored to fit the job description.

You import your raw resume data, refine it with help from AI, then add job descriptions. Suited picks the most relevant parts of your background, offers suggestions, and produces a polished PDF — without inventing anything.
Every word in the output traces back to something you actually wrote.

## How it works

1. **Import** your LinkedIn profile (URL, data export, or paste)
2. **Refine** — Claude asks targeted questions (and you can polish, direct-edit, or re-run Q&A) to improve **source → refined** data
3. **Jobs** — save job descriptions; **prepare** curates your profile per job; optional **cover letter** with AI refine/sniff; optional **professional feedback** before generating
4. **Generate** — paste or pick a saved JD and get a tailored PDF resume (and optional cover letter PDF)

Your data stays on your machine. Nothing is sent anywhere except to the AI API you configure.

## Installation

### Homebrew (macOS / Linux)

```bash
brew tap impressiver/suited
brew install suited
```

### npm (requires Node.js 20.12+)

```bash
npm install -g suited
```

### Pre-built binary (no Node.js required)

Download the latest binary for your platform from [GitHub Releases](https://github.com/impressiver/suited/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `suited-macos-arm64` |
| Linux (x64) | `suited-linux-x64` |

Make it executable and move it somewhere on your PATH:

```bash
chmod +x suited-macos-arm64
mv suited-macos-arm64 /usr/local/bin/suited
```

On macOS, Gatekeeper may block the binary on first run. Right-click → Open, or run:

```bash
xattr -d com.apple.quarantine /usr/local/bin/suited
```

## Requirements

- An API key from [Anthropic](https://console.anthropic.com/) or [OpenRouter](https://openrouter.ai/)
- Chrome or Chromium installed (only needed for `suited import <url>` and PDF export)

suited looks for Chrome in the default installation paths. To use a different binary, set `CHROME_PATH`:

```bash
export CHROME_PATH=/path/to/chrome
```

## Configuration

Set your API key in the environment or in a `.env` file in the directory where you run suited:

```
ANTHROPIC_API_KEY=your_key_here
# or
OPENROUTER_API_KEY=your_key_here
```

## Usage

### Default: full-screen TUI

In a normal **interactive terminal** (TTY):

```bash
suited
```

This launches the **Ink-based TUI**: **document shell** (TopBar + main + StatusBar) with **seven** top-level destinations — **Dashboard**, **Import**, **Contact**, **Editor** (general resume), **Jobs**, **Generate**, and **Settings** — via **:** (command palette), **`1–7`**, and letter keys. **Manual section editing** (`ProfileEditorScreen`) opens from the editor palette. In **Jobs**, selecting a job opens the resume editor with job context; **`l`** opens a full-screen **cover letter editor** with word wrap, AI refine (`r`), and AI sniff (`n`). **`Esc`** backs out through overlays and editors; wizards own **Esc** while in nested steps. See [`specs/tui-README.md`](specs/tui-README.md).

Core work runs through **`src/services/`** (shared with CLI subcommands). The TUI does **not** spawn subprocesses for those flows.

If **stdin or stdout is not a TTY** (e.g. pipes, CI), `suited` with no subcommand prints a one-line hint to stderr and exits without hanging (see [`specs/tui-README.md`](specs/tui-README.md)).

### Which command? (CLI subcommands)

The same pipeline is available as **subcommands** using **Inquirer**-style prompts (no Ink):

| Goal | Command |
|------|---------|
| First structured pass: Q&A and AI-assisted edits from **source → refined** data | `suited refine` |
| Ongoing **profile hub** (CLI menu): health, re-refine, bullets, summary, contact | `suited improve` |
| **Curate** your profile for one **saved job** (before generating a PDF) | `suited prepare` |
| Export a **PDF** for a job (paste or saved JD) | `suited generate` |

In the **TUI**, use **Resume** (health + validation + profile markdown preview), **Refine** (Q&A, polish, consultant, **manual section edit**), **Jobs** (prepare + curation preview + job-fit feedback), and **Generate** instead of `improve` / `prepare` / `validate` for most day-to-day work.

Use **`refine`** (or the Refine screen) when moving from raw import to refined data. Use **`improve`** or the **Profile** screen for ongoing edits. Use **`prepare`** or **Jobs → Prepare** after saving job descriptions. **`generate`** (or the Generate screen) produces the PDF.

### Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for entry points, `src/tui/`, `src/services/`, and how CLI vs TUI share logic.

### Import options

```bash
# From a LinkedIn profile URL
suited import https://www.linkedin.com/in/your-username

# From a LinkedIn data export ZIP (Settings → Data Privacy → Get a copy of your data)
suited import ~/Downloads/linkedin-export.zip

# From a CSV export directory
suited import ~/Downloads/Basic_LinkedInDataExport/

# Paste profile text directly
suited import
```

When importing by URL, suited opens Chrome and prompts for your LinkedIn credentials on first run. The session is saved under your **config** directory (XDG-style on Linux/macOS: typically `~/.config/suited/linkedin-session.json`; override with `XDG_CONFIG_HOME`). The same config directory holds **`contact.json`** (email, phone, headline, etc.—shared across all `--profile-dir` values). **Logo** fetches are cached under **`~/.cache/suited/logo-cache.json`** (or `XDG_CACHE_HOME`; `%LOCALAPPDATA%\suited\cache` on Windows). If you still have a legacy `~/.suited/linkedin-session.json`, it is read until you save a new session, then removed. Legacy `output/contact.json` or `output/logo-cache.json` are migrated on the next read or save. Only `linkedin.com` cookies are stored.

If LinkedIn requires 2FA or shows a CAPTCHA, use `--headed` to see the browser window:

```bash
suited import https://www.linkedin.com/in/your-username --headed
```

> **Note:** Use this tool only with your own LinkedIn profile. LinkedIn's Terms of Service prohibit automated scraping.

### Commands

| Command | What it does |
|---------|-------------|
| `suited` | Run the full pipeline interactively |
| `suited import` | Import your LinkedIn profile |
| `suited refine` | Q&A and edits: **source → refined** profile (skips if already refined) |
| `suited refine history list` / `restore <id>` | List or restore **refined-history/** snapshots; **`restore`** accepts **`--replace-head-only`** |
| `suited generate` | Build a PDF from refined data + job description |
| `suited improve` | Interactive hub: refine again, bullets, summary, contact |
| `suited jobs` | Add, list, delete saved job descriptions |
| `suited prepare` | Curate profile for one saved job before PDF |
| `suited validate` | Validate profile data and guardrails (summary also on **Dashboard** in the TUI) |

### Generate options

```bash
suited generate --jd "path/to/job.txt"   # skip the JD prompt
suited generate --flair 3                # set visual intensity (1–5)
suited generate --output output/resumes  # PDF output directory (see below)
suited generate --cover-letter            # with a job-targeted run, also export cover letter PDF (non-empty draft)
suited generate --cover-letter-only --job-id job-123   # only cover letter PDF (requires saved job id)
```

**PDF output:** By default, PDFs go under **`./resumes`** relative to the **current working directory** (job-tailored runs use subfolders such as `./resumes/{job-slug}/`). Use **`--output <dir>`** for a different path (relative paths resolve from cwd). Older releases defaulted to `output/resumes` under `--profile-dir`; existing files there are not moved. To keep that layout, pass e.g. `--output output/resumes`.

Settings are remembered between runs — if you regenerate without changes, you won't be re-prompted.

## Templates and flair

**Template** is the **baseline layout** (classic, modern, bold, timeline, retro). **Flair** (1–5) is a **separate** control: it sets how much stylistic freedom the generator applies **within** that baseline (tighter vs more varied presentation). In the **TUI**, you pick template and flair **independently**. On the **CLI**, if you only set `--flair`, the tool may still map flair (and industry) to a **default** template unless you pass an explicit template override — conservative industries often cap effective flair and classic-style output.

| Template | Style | Best for |
|----------|-------|----------|
| classic | Single column, serif, minimal | ATS submissions, academia, law, healthcare |
| modern | Two-column header, accent color | Most roles |
| bold | Full sidebar, color block header | Creative, design, tech |
| timeline | Visual work history | Roles where career progression matters |
| retro | Typographic, distinctive | Standing out |

**Flair** also interacts with **industry** (e.g. academia, healthcare, legal) so very high flair requests may be toned down for conservative roles — see the interactive **generate** flow for the effective settings.

## Accuracy guarantee

When generating for a specific job, suited serializes your entire profile into a reference list with stable IDs. Claude's instructions allow it only to select items from that list by ID — it cannot paraphrase, invent, or combine entries.

Before any PDF is produced, every reference is validated:
- Each ID must exist in the reference map
- IDs must match their declared type (a bullet can't be used as a summary)
- Bullets must belong to the position they're assigned to
- Resolved values must match what's stored

If any check fails, the pipeline halts.

## Working with your profile

After refining, suited creates `output/refined.md` — a plain-text file you can edit directly. On the next run, suited detects that the file has changed and asks whether to reload it before continuing. This is the easiest way to rewrite bullets, fix dates, or add anything LinkedIn didn't capture.

**Refinement history:** Each time `refined.json` is about to change (and a prior refined file already exists), suited stores the previous **`RefinedData`** under **`refined-history/`** as JSON snapshots (default cap: last 50; oldest pruned first). List or restore from the CLI: `suited refine history list` and `suited refine history restore <id>`, or from the TUI **Refine** hub (**View / restore refinement history**). **`suited refine history restore <id> --replace-head-only`** restores without snapshotting the current refined state first (you cannot undo that pre-restore version via history). To skip **all** history appends for a single CLI invocation or TUI session, pass **`--no-history-snapshot`** on **`suited`**, **`refine`**, **`generate`**, **`improve`**, or **`contact`**, or set **`SUITED_NO_HISTORY_SNAPSHOT=1`**. Restoring rewrites both `refined.json` and `refined.md` and clears per-job PDF squeeze hints (`pinnedRender`) that may no longer match. Snapshots duplicate the same PII as `refined.json`; if you sync or commit **`--profile-dir`** to the cloud or Git, treat **`refined-history/`** as sensitive too.

### Job-specific profiles

When you generate a resume for a specific job, suited saves a curated version of your profile to `output/jobs/{job-slug}/refined.md`. This file contains only the positions, bullets, and skills that were selected and polished for that job.

You can edit it directly — the next time you generate for that job, suited detects the change and asks whether to use your edits as the starting point instead of re-running curation.

```
output/                               # default --profile-dir (all paths relative to cwd)
  source.json / source.md
  refined.md                          # your full profile (editable)
  refined.json
  refined-history/                    # prior refined.json snapshots (auto, capped)
  jobs.json
  generation.json
  jobs/
    acme-corp-senior-engineer/
      refined.md                      # curated profile for this job (editable)
      refined.json
  refinements/
```

**Not in `output/`:** Contact overrides and LinkedIn session live under your **XDG config** directory; the logo cache lives under **XDG cache** (see [Import options](#import-options)). Generated **PDFs** default to **`./resumes/`** at the cwd (not inside `output/`).

## Multiple profiles

Use `--profile-dir` to keep separate profiles for different purposes:

```bash
suited import --profile-dir output/engineering
suited generate --profile-dir output/engineering
```

## Development

```bash
pnpm install
pnpm dev              # Run without building (default → TUI when TTY)
pnpm dev import       # Run a specific subcommand
pnpm check            # Lint + format (Biome)
pnpm test             # Unit tests (Vitest)
pnpm run ci           # test + TUI forbidden-import check + build (matches typical CI)
pnpm build            # Compile TypeScript → dist/
pnpm build:bundle     # Build esbuild CJS bundle (for testing)
pnpm build:binary     # Build SEA binary for current platform → dist-bin/
```

**TUI:** Source lives under `src/tui/`. CI enforces **`pnpm check:tui-imports`** — no `inquirer`, `ora`, or `src/commands/**` imports under `src/tui/**` (see [`specs/tui-testing.md`](specs/tui-testing.md)).

Contributing notes: [`CONTRIBUTING.md`](CONTRIBUTING.md). Module layout: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Project specification: [`specs/project.md`](specs/project.md). TUI spec index: [`specs/tui-README.md`](specs/tui-README.md). Definition of done (phases A–C): [`specs/tui-definition-of-done.md`](specs/tui-definition-of-done.md). Agent routing: [`specs/AGENTS.md`](specs/AGENTS.md). Spec index: [`specs/README.md`](specs/README.md). Security: [`SECURITY.md`](SECURITY.md).

## License

MIT — see [`LICENSE`](LICENSE).
