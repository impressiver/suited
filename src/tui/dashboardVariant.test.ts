import { describe, expect, it } from 'vitest';
import { getDashboardVariant } from './dashboardVariant.ts';

describe('getDashboardVariant', () => {
  it('returns no-api-key without provider keys', () => {
    expect(getDashboardVariant({ hasSource: true, hasRefined: true, jobsCount: 1 }, false)).toBe(
      'no-api-key',
    );
  });

  it('returns no-source when missing source', () => {
    expect(getDashboardVariant({ hasSource: false, hasRefined: false, jobsCount: 0 }, true)).toBe(
      'no-source',
    );
  });

  it('returns source-only with source but not refined', () => {
    expect(getDashboardVariant({ hasSource: true, hasRefined: false, jobsCount: 0 }, true)).toBe(
      'source-only',
    );
  });

  it('returns refined when refined but no jobs', () => {
    expect(getDashboardVariant({ hasSource: true, hasRefined: true, jobsCount: 0 }, true)).toBe(
      'refined',
    );
  });

  it('returns ready when refined and jobs exist', () => {
    expect(getDashboardVariant({ hasSource: true, hasRefined: true, jobsCount: 1 }, true)).toBe(
      'ready',
    );
  });
});
