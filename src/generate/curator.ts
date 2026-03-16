import { Profile, JobAnalysis, CurationPlan, CurationPlanSchema } from '../profile/schema.js';
import { callWithTool } from '../claude/client.js';
import { CURATE_SYSTEM, curateTool, buildRefList, RefEntry } from '../claude/prompts/curate.js';
import { assertAccurate } from '../claude/accuracy-guard.js';

export interface CuratorResult {
  plan: CurationPlan;
  refMap: Map<string, RefEntry>;
}

export async function curateForJob(
  profile: Profile,
  jobAnalysis: JobAnalysis,
): Promise<CuratorResult> {
  const { refText, refMap } = buildRefList(profile);

  const userMessage = `
## Job Details
Company: ${jobAnalysis.company}
Title: ${jobAnalysis.title}
Industry: ${jobAnalysis.industry}
Seniority: ${jobAnalysis.seniority}

Key Skills Required: ${jobAnalysis.keySkills.join(', ')}
Must Haves: ${jobAnalysis.mustHaves.join('; ')}
Nice to Haves: ${jobAnalysis.niceToHaves.join('; ')}

Job Summary: ${jobAnalysis.summary}

## Profile Data
${refText}

## Instructions
Select the most relevant experience, skills, projects, education, and certifications for this role.

For positions: use the position's id (e.g. "pos-0") as positionId. Only include bullets listed under that position's "Available bullets" section. Target 2-5 positions with 2-4 bullets each.

For all other sections: use the id field shown in parentheses. Include up to 15 skills. Include all relevant education. Include only certifications relevant to the role.

summaryRef: "summary" if relevant, otherwise null.
`.trim();

  const rawPlan = await callWithTool<CurationPlan>(
    CURATE_SYSTEM,
    userMessage,
    curateTool,
  );

  const parseResult = CurationPlanSchema.safeParse(rawPlan);
  if (!parseResult.success) {
    throw new Error(`CurationPlan schema validation failed: ${parseResult.error.message}`);
  }

  const plan = parseResult.data;

  // Accuracy guard — throws AccuracyGuardError if any ref is invalid
  assertAccurate(plan, profile, refMap);

  return { plan, refMap };
}
