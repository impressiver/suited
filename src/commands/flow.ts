/**
 * Default entry point: runs when `suited` is invoked without a subcommand.
 * Interactive TTY → Ink TUI; otherwise a one-line hint (no hang).
 */

export interface FlowOptions {
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
}

function isInteractiveTty(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function runFlow(options: FlowOptions): Promise<void> {
  if (isInteractiveTty()) {
    const { runTui } = await import('../tui/runTui.js');
    await runTui(options);
    return;
  }

  console.error(
    'suited: open an interactive terminal to use the dashboard, or run e.g. suited --help, suited refine',
  );
  process.exitCode = 0;
}
