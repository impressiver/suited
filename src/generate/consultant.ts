import { callWithTool } from '../claude/client.js';
import { profileToRefineText } from '../claude/prompts/refine.js';
import {
  PROFILE_CONSULTANT_SYSTEM, profileEvalTool, ProfileEvaluation,
  JOB_CONSULTANT_SYSTEM, jobEvalTool, JobEvaluation,
  resumeDocToConsultantText,
  APPLY_JOB_FEEDBACK_SYSTEM, applyJobFeedbackTool, JobFeedbackOutput,
  buildJobFeedbackPrompt, ConsultantFinding,
  FEEDBACK_QUESTIONS_SYSTEM, feedbackQuestionsTool, FeedbackQuestionsOutput,
  buildFeedbackQuestionsPrompt,
} from '../claude/prompts/consultant.js';
import { Profile, ResumeDocument, JobAnalysis } from '../profile/schema.js';
import { c } from '../utils/colors.js';
import chalk from 'chalk';

/** Run the hiring consultant evaluation on a general (non-tailored) profile. */
export async function evaluateProfile(profile: Profile): Promise<ProfileEvaluation> {
  return callWithTool<ProfileEvaluation>(
    PROFILE_CONSULTANT_SYSTEM,
    `Please evaluate this candidate's resume profile:\n\n${profileToRefineText(profile)}`,
    profileEvalTool,
  );
}

/** Run the hiring consultant evaluation on a resume tailored for a specific job. */
export async function evaluateForJob(doc: ResumeDocument, jobAnalysis: JobAnalysis): Promise<JobEvaluation> {
  return callWithTool<JobEvaluation>(
    JOB_CONSULTANT_SYSTEM,
    `Please evaluate how well this resume is tailored for the role:\n\n${resumeDocToConsultantText(doc, jobAnalysis)}`,
    jobEvalTool,
  );
}

// ---------------------------------------------------------------------------
// User enrichment — ask Claude what questions are needed, then prompt the user
// ---------------------------------------------------------------------------

/**
 * Uses Claude to determine which selected findings require additional factual
 * information from the candidate (metrics, outcomes, team sizes, etc.) that
 * isn't already in the profile. Prompts the user only for those specific facts,
 * then returns findings enriched with the answers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function enrichFindingsWithUserInput(findings: ConsultantFinding[], inquirer: any, profileContext: string): Promise<ConsultantFinding[]> {
  let questionsOutput: FeedbackQuestionsOutput;
  try {
    questionsOutput = await callWithTool<FeedbackQuestionsOutput>(
      FEEDBACK_QUESTIONS_SYSTEM,
      buildFeedbackQuestionsPrompt(findings, profileContext),
      feedbackQuestionsTool,
    );
  } catch {
    // If the question-generation call fails, proceed without enrichment
    return findings;
  }

  const { questions } = questionsOutput;
  if (questions.length === 0) return findings;

  console.log(c.muted('\n  A few questions to fill in the details:'));

  const answers = new Map<number, string>();
  for (const q of questions) {
    const finding = findings[q.findingIndex];
    if (!finding) continue;

    console.log(`\n  ${chalk.bold(finding.area)}`);
    console.log(`  ${c.muted(finding.suggestion)}`);

    const { answer } = await inquirer.prompt([{
      type: 'input',
      name: 'answer',
      message: `  ${q.question}`,
    }]) as { answer: string };

    if (answer.trim()) answers.set(q.findingIndex, answer.trim());
  }

  return findings.map((f, i) => {
    const answer = answers.get(i);
    return answer
      ? { ...f, suggestion: `${f.suggestion}\n  Candidate's details: ${answer}` }
      : f;
  });
}

/** Serialise a ResumeDocument into plain text for use as profile context. */
export function resumeDocContext(doc: ResumeDocument): string {
  const lines: string[] = [];
  if (doc.summary) lines.push(`Summary: ${doc.summary}\n`);
  lines.push('Experience:');
  for (const pos of doc.positions) {
    lines.push(`  ${pos.title} at ${pos.company}`);
    for (const b of pos.bullets) lines.push(`    • ${b}`);
  }
  if (doc.skills.length > 0) lines.push(`\nSkills: ${doc.skills.join(', ')}`);
  return lines.join('\n');
}

/** Apply selected consultant gap findings to a ResumeDocument. */
export async function applyJobFeedback(
  doc: ResumeDocument,
  jobAnalysis: JobAnalysis,
  gaps: ConsultantFinding[],
): Promise<ResumeDocument> {
  const prompt = buildJobFeedbackPrompt(doc, jobAnalysis, gaps);
  const output = await callWithTool<JobFeedbackOutput>(APPLY_JOB_FEEDBACK_SYSTEM, prompt, applyJobFeedbackTool);

  const updatedPositions = [...doc.positions];
  for (const change of output.positions ?? []) {
    const { index, bullets } = change;
    if (index < 0 || index >= updatedPositions.length) continue;
    if (!Array.isArray(bullets) || bullets.length === 0) continue;
    updatedPositions[index] = { ...updatedPositions[index], bullets };
  }

  const updated: ResumeDocument = { ...doc, positions: updatedPositions };
  if (output.summary?.trim()) updated.summary = output.summary.trim();
  if (output.skills && output.skills.length > 0) updated.skills = output.skills;

  return updated;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 8) return chalk.green(String(score));
  if (score >= 6) return chalk.yellow(String(score));
  return chalk.red(String(score));
}

export function printProfileEvaluation(ev: ProfileEvaluation): void {
  console.log(`\n${chalk.bold.cyan('─── Hiring Consultant Review ' + '─'.repeat(40))}`);
  console.log(`  ${c.label('Score:')} ${scoreColor(ev.overallScore)}${c.muted('/10')}`);

  if (ev.strengths.length > 0) {
    console.log(`\n  ${chalk.green.bold('Strengths')}`);
    for (const s of ev.strengths) {
      console.log(`    ${c.ok} ${s}`);
    }
  }

  if (ev.improvements.length > 0) {
    console.log(`\n  ${chalk.yellow.bold('Areas to Improve')}`);
    for (const imp of ev.improvements) {
      console.log(`\n    ${c.warn} ${chalk.bold(imp.area)}`);
      console.log(`      ${c.muted('Issue:')} ${imp.issue}`);
      console.log(`      ${c.arr} ${imp.suggestion}`);
    }
  }

  console.log(`\n  ${c.label('Verdict:')} ${chalk.italic(ev.verdict)}`);
  console.log(chalk.dim('─'.repeat(70)));
}

export function printJobEvaluation(ev: JobEvaluation): void {
  console.log(`\n${chalk.bold.cyan('─── Job Fit Review ' + '─'.repeat(49))}`);
  console.log(`  ${c.label('Alignment Score:')} ${scoreColor(ev.alignmentScore)}${c.muted('/10')}`);

  if (ev.strengths.length > 0) {
    console.log(`\n  ${chalk.green.bold('Strong Alignment')}`);
    for (const s of ev.strengths) {
      console.log(`    ${c.ok} ${s}`);
    }
  }

  if (ev.gaps.length > 0) {
    console.log(`\n  ${chalk.yellow.bold('Gaps to Address')}`);
    for (const gap of ev.gaps) {
      console.log(`\n    ${c.warn} ${chalk.bold(gap.area)}`);
      console.log(`      ${c.muted('Issue:')} ${gap.issue}`);
      console.log(`      ${c.arr} ${gap.suggestion}`);
    }
  }

  console.log(`\n  ${c.label('Verdict:')} ${chalk.italic(ev.verdict)}`);
  console.log(chalk.dim('─'.repeat(70)));
}
