# suited

A CLI tool that generates factually-accurate PDF resumes from source data (eg. LinkedIn profile) tailored to fit the job description.

You import your raw resume data, refine it with help from AI, then add job descriptions. Suited picks the most relevant parts of your background, offers suggestions, and produces a polished PDF — without inventing anything.
Every word in the output traces back to something you actually wrote.

## How it works

1. **Import** your LinkedIn profile (URL, data export, or paste)
2. **Refine** — Claude asks a few targeted questions to fill gaps and sharpen weak bullets
3. **Generate** — paste a job description and get a tailored PDF resume

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

Run the full pipeline:

```bash
suited
```

That's it. suited walks you through each step interactively and skips anything already done.

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

When importing by URL, suited opens Chrome and prompts for your LinkedIn credentials on first run. The session is saved to `~/.suited/linkedin-session.json` so you only need to log in once. Only `linkedin.com` cookies are stored.

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
| `suited refine` | Improve your profile with Claude Q&A |
| `suited generate` | Generate a PDF resume |
| `suited improve` | Edit profile bullets and contact info |
| `suited jobs` | Manage saved job descriptions |
| `suited prepare` | Curate a resume for a specific saved job |
| `suited validate` | Check profile data integrity |

### Generate options

```bash
suited generate --jd "path/to/job.txt"   # skip the JD prompt
suited generate --flair 3                # set visual intensity (1–5)
```

Settings are remembered between runs — if you regenerate without changes, you won't be re-prompted.

## Templates

Suited picks the right template based on flair level, or you can choose manually.

| Template | Style | Best for |
|----------|-------|----------|
| classic | Single column, serif, minimal | ATS submissions, academia, law, healthcare |
| modern | Two-column header, accent color | Most roles |
| bold | Full sidebar, color block header | Creative, design, tech |
| timeline | Visual work history | Roles where career progression matters |
| retro | Typographic, distinctive | Standing out |

**Flair levels** (1–5) control how visually expressive the output is. Flair 1–2 always uses the classic template. Academia, healthcare, and legal roles default to classic regardless of flair.

## Accuracy guarantee

When generating for a specific job, suited serializes your entire profile into a reference list with stable IDs. Claude's instructions allow it only to select items from that list by ID — it cannot paraphrase, invent, or combine entries.

Before any PDF is produced, every reference is validated:
- Each ID must exist in the reference map
- IDs must match their declared type (a bullet can't be used as a summary)
- Bullets must belong to the position they're assigned to
- Resolved values must match what's stored

If any check fails, the pipeline halts.

## Working with your profile

After importing, suited creates `output/refined.md` — a plain-text file you can edit directly. Changes are detected automatically on the next run. This is the easiest way to rewrite bullets, fix dates, or add anything LinkedIn didn't capture.

## Multiple profiles

Use `--profile-dir` to keep separate profiles for different purposes:

```bash
suited import --profile-dir output/engineering
suited generate --profile-dir output/engineering
```

## Development

```bash
pnpm install
pnpm dev              # Run without building
pnpm dev import       # Run a specific command
pnpm build            # Compile TypeScript → dist/
pnpm build:bundle     # Build esbuild CJS bundle (for testing)
pnpm build:binary     # Build SEA binary for current platform → dist-bin/
```
