# Terminal & environment

Canonical non-TTY behavior is defined in [README](./README.md#canonical-non-tty-behavior-single-source-of-truth).

- **TTY gate:** `runTui()` only when both `stdin.isTTY` and `stdout.isTTY`. When not interactive, **do not** block on input; follow the README’s stderr + exit-code rules (implementation: `src/commands/flow.ts`).
- **Size:** Full sidebar + content layout at ≥80×24. Below 80 columns: Jobs and similar two-panel screens switch to stacked layout. Below 24 rows: shorten Header/Footer to one-liners.
- **Resize:** React to Ink resize events (or `SIGWINCH`); re-layout without restart. Truncate Header metadata with `…` rather than overlapping panes.
- **Color & symbols:** Respect `NO_COLOR`. Diff and badges are readable via `+`/`-`, dim/bold, and brackets — not color alone.
- **Paste:** `<MultilineInput>` shows a clear hint for submission key (Ctrl+D). Shows character count; soft warning at ~4,000 chars before sending to the API.
- **`$EDITOR` policy:** **Do not** spawn `$EDITOR` from the TUI. All editing happens inline via `<InlineEditor>` or `<MultilineInput>`. The `--edit` flag on CLI subcommands may still use `$EDITOR`; the TUI does not.
- **Logging:** All user-facing output is in the Ink render tree. Stack traces go to stderr, gated by `DEBUG=suited:*` (or project convention). Never `console.log` from TUI screen code for UX text.

## SSH, tmux, and IDE terminals

**SHOULD** test on: macOS Terminal, iTerm2, VS Code integrated terminal, and one **SSH session** to Linux. Kitty sequences and bracketed paste differ; Ink handles most cases — document any known quirks in issues if they appear.

## Windows / WSL

**SHOULD** verify `suited` with no args on **Windows Terminal + WSL** at least once per major Ink upgrade; path and `argv[1]` behavior for subprocess delegation (Phase A) may differ from Unix.
