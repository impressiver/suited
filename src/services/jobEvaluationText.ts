import type { JobEvaluation, ProfileEvaluation } from '../claude/prompts/consultant.ts';

/** Plain lines for Ink `ScrollView` (general profile consultant output). */
export function formatProfileEvaluationLines(ev: ProfileEvaluation): string[] {
  const lines: string[] = [];
  lines.push(`Hiring consultant review — overall ${ev.overallScore}/10`);
  lines.push('');

  if (ev.strengths.length > 0) {
    lines.push('Strengths');
    for (const s of ev.strengths) {
      lines.push(`  + ${s}`);
    }
    lines.push('');
  }

  if (ev.improvements.length > 0) {
    lines.push('Areas to improve');
    for (const imp of ev.improvements) {
      lines.push(`  • ${imp.area}`);
      lines.push(`    Issue: ${imp.issue}`);
      lines.push(`    → ${imp.suggestion}`);
      lines.push('');
    }
  }

  lines.push(`Verdict: ${ev.verdict}`);
  return lines;
}

/** Plain lines for Ink `ScrollView` (job-fit consultant output). */
export function formatJobEvaluationLines(ev: JobEvaluation): string[] {
  const lines: string[] = [];
  lines.push(`Job fit review — alignment ${ev.alignmentScore}/10`);
  lines.push('');

  if (ev.strengths.length > 0) {
    lines.push('Strong alignment');
    for (const s of ev.strengths) {
      lines.push(`  + ${s}`);
    }
    lines.push('');
  }

  if (ev.gaps.length > 0) {
    lines.push('Gaps to address');
    for (const gap of ev.gaps) {
      lines.push(`  • ${gap.area}`);
      lines.push(`    Issue: ${gap.issue}`);
      lines.push(`    → ${gap.suggestion}`);
      lines.push('');
    }
  }

  lines.push(`Verdict: ${ev.verdict}`);
  return lines;
}
