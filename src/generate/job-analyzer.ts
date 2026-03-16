import { JobAnalysis } from '../profile/schema.js';
import { callWithTool } from '../claude/client.js';
import { ANALYZE_JD_SYSTEM, analyzeJdTool } from '../claude/prompts/analyze-jd.js';

export async function analyzeJobDescription(jdText: string): Promise<JobAnalysis> {
  return callWithTool<JobAnalysis>(
    ANALYZE_JD_SYSTEM,
    `Analyze this job description and extract structured information:\n\n${jdText}`,
    analyzeJdTool,
  );
}
