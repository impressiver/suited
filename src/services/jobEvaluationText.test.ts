import { describe, expect, it } from 'vitest';
import type { ProfileEvaluation } from '../claude/prompts/consultant.ts';
import { formatProfileEvaluationLines } from './jobEvaluationText.ts';

describe('formatProfileEvaluationLines', () => {
  it('formats score, strengths, improvements, and verdict', () => {
    const ev: ProfileEvaluation = {
      overallScore: 7,
      strengths: ['Clear structure'],
      improvements: [
        {
          area: 'Summary',
          issue: 'Too generic',
          suggestion: 'Lead with impact metrics',
        },
      ],
      verdict: 'Solid base with room to sharpen.',
    };
    const lines = formatProfileEvaluationLines(ev);
    expect(lines.some((l) => l.includes('7/10'))).toBe(true);
    expect(lines.some((l) => l.includes('Strengths'))).toBe(true);
    expect(lines.some((l) => l.includes('Clear structure'))).toBe(true);
    expect(lines.some((l) => l.includes('Areas to improve'))).toBe(true);
    expect(lines.some((l) => l.includes('Summary'))).toBe(true);
    expect(lines.some((l) => l.includes('Solid base'))).toBe(true);
  });

  it('prefixes section scope when provided', () => {
    const ev: ProfileEvaluation = {
      overallScore: 6,
      strengths: [],
      improvements: [],
      verdict: 'OK.',
    };
    const lines = formatProfileEvaluationLines(ev, { sectionScope: 'Summary' });
    expect(lines[0]).toBe('Section focus: Summary');
    expect(lines[1]).toBe('');
  });
});
