import { assertAccurate } from '../claude/accuracy-guard.js';
import { callWithTool } from '../claude/client.js';
import {
  buildRefList,
  CURATE_SYSTEM,
  curateTool,
  type RefEntry,
} from '../claude/prompts/curate.js';
import {
  type CurationPlan,
  CurationPlanSchema,
  type JobAnalysis,
  type Profile,
} from '../profile/schema.js';

export interface CuratorResult {
  plan: CurationPlan;
  refMap: Map<string, RefEntry>;
}

/**
 * Ensures the selected positions form a gap-free employment history:
 *  1. The most recent position (and its promotion chain) is always included.
 *  2. Any position that sits chronologically *between* two selected positions
 *     is added automatically — omitting it would create a visible employment gap.
 *
 * Positions are returned in most-recent-first order (matching profile order).
 */
function ensureConsecutiveEmployment(plan: CurationPlan, profile: Profile): CurationPlan {
  if (profile.positions.length === 0) return plan;

  // Sort profile positions most-recent-first (YYYY-MM lexicographic sort is correct)
  const sorted = [...profile.positions].sort((a, b) =>
    b.startDate.value.localeCompare(a.startDate.value),
  );

  const selectedIds = new Set(plan.selectedPositions.map((p) => p.positionId));

  // Always include the most recent position and its promotion chain
  const recentCompany = sorted[0].company.value.toLowerCase().trim();
  for (const pos of profile.positions) {
    if (pos.company.value.toLowerCase().trim() === recentCompany) {
      selectedIds.add(pos.id);
    }
  }

  // Find the index of the oldest selected position in the sorted array
  const lastIdx = sorted.reduce(
    (max, pos, i) => (selectedIds.has(pos.id) ? Math.max(max, i) : max),
    -1,
  );

  // Every position from index 0 to lastIdx must be included to avoid gaps
  const existingByPositionId = new Map(plan.selectedPositions.map((p) => [p.positionId, p]));
  const filledPositions = sorted.slice(0, lastIdx + 1).map((pos) => {
    if (existingByPositionId.has(pos.id)) return existingByPositionId.get(pos.id)!;
    // Gap-fill: include the position with all its bullets
    return {
      positionId: pos.id,
      bulletRefs: pos.bullets.map((_, i) => `b:${pos.id}:${i}`),
    };
  });

  return { ...plan, selectedPositions: filledPositions };
}

/**
 * Returns a ref map for the given profile without running curation.
 * Used to reassemble a ResumeDocument from a stored CurationPlan.
 */
export function buildRefMapForProfile(profile: Profile): Map<string, RefEntry> {
  return buildRefList(profile).refMap;
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
Select experience, skills, projects, education, and certifications to build a full, complete resume.

For positions: use the position's id (e.g. "pos-0") as positionId. Include ALL available bullets for every selected position — do not trim bullets at this stage. Target 3–6 positions. The candidate will have a chance to trim later. Only include bullets listed under that position's "Available bullets" section.

For skills: include all skills a hiring manager for this role would want to see. Drop skills that are clearly irrelevant to the role, redundant (e.g. listing both "JavaScript" and "JS"), or trivial (tools so common they add no signal, like "Microsoft Office" or "Git" on a senior engineering role). Do not apply a count limit — include everything meaningful.

For education: include ALL education entries.

For projects and certifications: include all of them.

summaryRef: "summary" if present, otherwise null.
`.trim();

  const rawPlan = await callWithTool<CurationPlan>(CURATE_SYSTEM, userMessage, curateTool);

  const parseResult = CurationPlanSchema.safeParse(rawPlan);
  if (!parseResult.success) {
    throw new Error(`CurationPlan schema validation failed: ${parseResult.error.message}`);
  }

  const plan = parseResult.data;

  // Accuracy guard — throws AccuracyGuardError if any ref is invalid
  assertAccurate(plan, profile, refMap);

  // Hard guarantee: no gaps in employment history, most recent always included
  const finalPlan = ensureConsecutiveEmployment(plan, profile);

  return { plan: finalPlan, refMap };
}
