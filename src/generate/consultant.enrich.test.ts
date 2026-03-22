import { describe, expect, it } from 'vitest';
import { mergeConsultantFindingAnswers } from './consultant.ts';

describe('mergeConsultantFindingAnswers', () => {
  it('appends candidate details only for indices with answers', () => {
    const findings = [
      { area: 'Summary', issue: 'Weak hook', suggestion: 'Lead with impact.' },
      { area: 'Skills', issue: 'Buried', suggestion: 'Surface cloud keywords.' },
    ];
    const answers = new Map<number, string>([[0, 'Cut infra spend 40%']]);
    const out = mergeConsultantFindingAnswers(findings, answers);
    expect(out[0]?.suggestion).toContain('Cut infra spend 40%');
    expect(out[0]?.suggestion).toContain('Candidate');
    expect(out[1]?.suggestion).toBe('Surface cloud keywords.');
  });
});
