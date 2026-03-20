import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runFlow non-TTY', () => {
  let stdinTTY: boolean | undefined;
  let stdoutTTY: boolean | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdinTTY = process.stdin.isTTY;
    stdoutTTY = process.stdout.isTTY;
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: stdoutTTY, configurable: true });
  });

  it('prints one-line stderr and sets exit 0 (canonical non-interactive)', async () => {
    const { runFlow } = await import('./flow.js');
    await runFlow({});
    expect(stderrSpy).toHaveBeenCalledWith(
      'suited: open an interactive terminal to use the dashboard, or run e.g. suited --help, suited refine',
    );
    expect(process.exitCode).toBe(0);
  });
});
