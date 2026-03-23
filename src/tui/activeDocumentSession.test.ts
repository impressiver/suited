import { describe, expect, it } from 'vitest';
import {
  formatTopBarJobLine,
  globalRefinedTarget,
  isJobTarget,
  jobRefinedTarget,
  persistenceTargetKey,
  persistenceTargetsEqual,
} from './activeDocumentSession.ts';

describe('activeDocumentSession', () => {
  it('keys global vs job', () => {
    expect(persistenceTargetKey(globalRefinedTarget())).toBe('global-refined');
    expect(persistenceTargetKey(jobRefinedTarget('id1', 'acme-staff'))).toBe('job:acme-staff');
  });

  it('formats top bar job line', () => {
    expect(formatTopBarJobLine(globalRefinedTarget())).toBe('Job: —');
    expect(formatTopBarJobLine(jobRefinedTarget('x', 'acme-staff'))).toBe('Job: acme-staff');
  });

  it('persistenceTargetsEqual', () => {
    expect(persistenceTargetsEqual(globalRefinedTarget(), globalRefinedTarget())).toBe(true);
    expect(persistenceTargetsEqual(jobRefinedTarget('a', 'x'), jobRefinedTarget('a', 'x'))).toBe(
      true,
    );
    expect(persistenceTargetsEqual(globalRefinedTarget(), jobRefinedTarget('a', 'x'))).toBe(false);
    expect(persistenceTargetsEqual(jobRefinedTarget('a', 'x'), jobRefinedTarget('b', 'x'))).toBe(
      false,
    );
  });

  it('isJobTarget narrows', () => {
    expect(isJobTarget(globalRefinedTarget())).toBe(false);
    const j = jobRefinedTarget('x', 'y');
    expect(isJobTarget(j)).toBe(true);
    if (isJobTarget(j)) {
      expect(j.slug).toBe('y');
    }
  });
});
