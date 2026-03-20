import { describe, expect, it } from 'vitest';
import {
  JOBS_SPLIT_PANE_MIN_COLS,
  jobsListPaneWidth,
  jobsUseSplitPane,
} from './jobsLayout.ts';

describe('jobsUseSplitPane', () => {
  it('is false below 80 columns', () => {
    expect(jobsUseSplitPane(79)).toBe(false);
  });

  it('is true at 80 columns', () => {
    expect(jobsUseSplitPane(80)).toBe(true);
    expect(jobsUseSplitPane(120)).toBe(true);
  });

  it('exposes spec threshold as constant', () => {
    expect(JOBS_SPLIT_PANE_MIN_COLS).toBe(80);
  });
});

describe('jobsListPaneWidth', () => {
  it('returns full width when stacked', () => {
    expect(jobsListPaneWidth(79)).toBe(79);
  });

  it('returns a fraction of width when split', () => {
    expect(jobsListPaneWidth(100)).toBe(40);
    expect(jobsListPaneWidth(80)).toBe(32);
  });
});
