import { describe, expect, it } from 'vitest';
import { formatPipelineStrip } from './pipelineStrip.ts';

const sampleSnapshot = {
  hasSource: true,
  hasRefined: false,
  jobsCount: 2,
  lastPdfLine: null as string | null,
};

describe('formatPipelineStrip', () => {
  it('marks stages with filled or empty dots', () => {
    expect(formatPipelineStrip(sampleSnapshot)).toBe('Source ● · Refined ○ · Jobs ● · Last PDF ○');
  });

  it('shows last PDF when line present', () => {
    expect(
      formatPipelineStrip({
        hasSource: true,
        hasRefined: true,
        jobsCount: 0,
        lastPdfLine: 'Acme — Role (1/1/2025, classic)',
      }),
    ).toBe('Source ● · Refined ● · Jobs ○ · Last PDF ●');
  });

  it('uses ASCII [x]/[ ] ticks when noColor (NO_COLOR matrix)', () => {
    const colored = formatPipelineStrip(sampleSnapshot);
    const plain = formatPipelineStrip(sampleSnapshot, { noColor: true });
    expect(colored).not.toBe(plain);
    expect(plain).toBe('Source [x] · Refined [ ] · Jobs [x] · Last PDF [ ]');
  });

  it('no-color strip matches matrix for all-done snapshot', () => {
    expect(
      formatPipelineStrip(
        {
          hasSource: true,
          hasRefined: true,
          jobsCount: 1,
          lastPdfLine: 'x',
        },
        { noColor: true },
      ),
    ).toBe('Source [x] · Refined [x] · Jobs [x] · Last PDF [x]');
  });
});
