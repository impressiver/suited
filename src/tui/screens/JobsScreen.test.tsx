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

  it('renders stacked label at 79 columns (no Preview pane)', () => {
    mockUseTerminalSize.mockReturnValue([79, 30]);
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp/suited-test-jobs">
        <JobsScreen profileDir="/tmp/suited-test-jobs" />
      </AppStoreProvider>,
    );
    expect(out).toContain('Saved jobs');
    expect(out).not.toContain('Preview');
  });

  it('renders two-column hint at 80+ columns', () => {
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
