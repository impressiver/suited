import { renderToString } from 'ink';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreProvider } from '../store.tsx';
import { JobsScreen } from './JobsScreen.tsx';

const mockUseTerminalSize = vi.fn(() => [100, 30] as [number, number]);

vi.mock('../hooks/useTerminalSize.ts', () => ({
  useTerminalSize: () => mockUseTerminalSize(),
}));

describe('JobsScreen layout', () => {
  beforeEach(() => {
    mockUseTerminalSize.mockReset();
  });

  it('renders Preview below job list at narrow width', () => {
    mockUseTerminalSize.mockReturnValue([79, 30]);
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp/suited-test-jobs">
        <JobsScreen profileDir="/tmp/suited-test-jobs" />
      </AppStoreProvider>,
    );
    expect(out).toContain('Saved jobs');
    expect(out).toContain('Preview');
  });

  it('renders Preview below job list at wide width', () => {
    mockUseTerminalSize.mockReturnValue([100, 30]);
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp/suited-test-jobs">
        <JobsScreen profileDir="/tmp/suited-test-jobs" />
      </AppStoreProvider>,
    );
    expect(out).toContain('Saved jobs');
    expect(out).toContain('Preview');
  });
});
