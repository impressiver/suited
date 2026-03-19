# Security

## Supported versions

Security fixes are applied to the latest release on the default branch. Use the newest published version when possible.

## Reporting a vulnerability

Please report security issues **privately** so we can fix them before public disclosure.

1. Open a **GitHub Security Advisory** on this repository (if enabled), **or**
2. Email the maintainers with a clear subject line (e.g. `[security] suited: …`) and enough detail to reproduce or assess impact.

Include: affected command or code path, steps to reproduce, and impact if known.

## Scope

This tool stores profile data locally, may keep a LinkedIn session file under `~/.suited/`, and sends prompts to the AI provider you configure. Treat API keys and session files as sensitive.

## LinkedIn and scraping

Only use import features with **your own** data and in line with LinkedIn’s terms. Automated access may violate their policies; use is at your own risk.
