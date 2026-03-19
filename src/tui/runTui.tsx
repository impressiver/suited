import { spawnSync } from 'node:child_process';
import { render } from 'ink';
import type { FlowOptions } from '../commands/flow.js';
import { App } from './App.js';

export async function runTui(options: FlowOptions): Promise<void> {
  const profileDir = options.profileDir ?? 'output';
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new Error('Could not resolve CLI entry (process.argv[1] is empty)');
  }

  while (true) {
    const exitBag = { pending: null as string[] | null, quit: false };
    const { waitUntilExit } = render(
      <App profileDir={profileDir} flowOptions={options} exitBag={exitBag} />,
    );
    await waitUntilExit();

    if (exitBag.quit) {
      return;
    }

    if (exitBag.pending?.length) {
      const r = spawnSync(process.execPath, [cliPath, ...exitBag.pending], {
        stdio: 'inherit',
      });
      if (r.error) {
        throw r.error;
      }
      continue;
    }

    return;
  }
}
