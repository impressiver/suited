import { describe, expect, it } from 'vitest';
import { formatPipelineStrip } from './pipelineStrip.ts';

describe('formatPipelineStrip', () => {
  it('marks stages with filled or empty dots', () => {
    expect(
      formatPipelineStrip({
        hasSource: true,
        hasRefined: false,
        jobsCount: 2,
        lastPdfLine: null,
      }),
    ).toBe('Source ● · Refined ○ · Jobs ● · Last PDF ○');
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
});
