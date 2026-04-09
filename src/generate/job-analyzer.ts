import { callWithTool } from '../claude/client.ts';
import { ANALYZE_JD_SYSTEM, analyzeJdTool } from '../claude/prompts/analyze-jd.ts';
import type { JobAnalysis } from '../profile/schema.ts';

export async function analyzeJobDescription(jdText: string): Promise<JobAnalysis> {
  return callWithTool<JobAnalysis>(
    ANALYZE_JD_SYSTEM,
    `Analyze this job description and extract structured information:\n\n${jdText}`,
    analyzeJdTool,
  );
}
