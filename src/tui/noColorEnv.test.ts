import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseNoColor } from './env.ts';
import { formatPipelineStrip } from './pipelineStrip.ts';

describe('shouldUseNoColor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when NO_COLOR is unset', () => {
    vi.stubEnv('NO_COLOR', undefined);
    expect(shouldUseNoColor()).toBe(false);
  });

  it('is false when NO_COLOR is empty (spec: only non-empty disables)', () => {
    vi.stubEnv('NO_COLOR', '');
    expect(shouldUseNoColor()).toBe(false);
  });

  it('is true when NO_COLOR is non-empty (e.g. 1)', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(shouldUseNoColor()).toBe(true);
  });

  it('pipeline strip uses ASCII ticks when wired with shouldUseNoColor under NO_COLOR=1', () => {
    vi.stubEnv('NO_COLOR', '1');
    const line = formatPipelineStrip(
      {
        hasSource: true,
        hasRefined: false,
        jobsCount: 0,
        lastPdfLine: null,
      },
      { noColor: shouldUseNoColor() },
    );
    expect(line).toBe('Source [x] · Refined [ ] · Jobs [ ] · Last PDF [ ]');
  });
});
