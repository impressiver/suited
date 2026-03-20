import { render } from 'ink';
import { App } from './App.tsx';
import type { FlowOptions } from './flowOptions.ts';
import { AppStoreProvider } from './store.tsx';

export async function runTui(options: FlowOptions): Promise<void> {
  const profileDir = options.profileDir ?? 'output';
  const { waitUntilExit } = render(
    <AppStoreProvider profileDir={profileDir}>
      <App profileDir={profileDir} flowOptions={options} />
    </AppStoreProvider>,
  );
  await waitUntilExit();
}
