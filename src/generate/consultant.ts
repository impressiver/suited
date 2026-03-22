import { APIUserAbortError } from '@anthropic-ai/sdk';
import chalk from 'chalk';
import { callWithTool } from '../claude/client.ts';
import {
  APPLY_JOB_FEEDBACK_SYSTEM,
  applyJobFeedbackTool,
  buildFeedbackQuestionsPrompt,
  buildJobFeedbackPrompt,
  type ConsultantFinding,
  FEEDBACK_QUESTIONS_SYSTEM,
  type FeedbackQuestion,
  type FeedbackQuestionsOutput,
  feedbackQuestionsTool,
  JOB_CONSULTANT_SYSTEM,
  type JobEvaluation,
  type JobFeedbackOutput,
  jobEvalTool,
  PROFILE_CONSULTANT_SYSTEM,
  type ProfileEvaluation,
  profileEvalTool,
  resumeDocToConsultantText,
} from '../claude/prompts/consultant.ts';
import { profileToRefineText } from '../claude/prompts/refine.ts';
import type { JobAnalysis, Profile, ResumeDocument } from '../profile/schema.ts';
import { c } from '../utils/colors.ts';
import {
  replaceEmDashes,
  sanitizeConsultantFindings,
  sanitizeJobEvaluation,
  sanitizeProfileEvaluation,
  sanitizeResumeDocument,
} from '../utils/noEmDash.ts';

type InquirerCLI = typeof import('inquirer').default;

/** Run the hiring consultant evaluation on a general (non-tailored) profile. */
export async function evaluateProfile(profile: Profile): Promise<ProfileEvaluation> {
  const ev = await callWithTool<ProfileEvaluation>(
    PROFILE_CONSULTANT_SYSTEM,
    `Please evaluate this candidate's resume profile:\n\n${profileToRefineText(profile)}`,
    profileEvalTool,
  );
  return sanitizeProfileEvaluation(ev);
}

/** Run the hiring consultant evaluation on a resume tailored for a specific job. */
export async function evaluateForJob(
  doc: ResumeDocument,
  jobAnalysis: JobAnalysis,
): Promise<JobEvaluation> {
  const ev = await callWithTool<JobEvaluation>(
    JOB_CONSULTANT_SYSTEM,
    `Please evaluate how well this resume is tailored for the role:\n\n${resumeDocToConsultantText(doc, jobAnalysis)}`,
    jobEvalTool,
  );
  return sanitizeJobEvaluation(ev);
}

// ---------------------------------------------------------------------------
// User enrichment — ask Claude what questions are needed, then prompt the user
// ---------------------------------------------------------------------------

/** Append factual answers to findings (same shape the apply prompt expects). */
export function mergeConsultantFindingAnswers(
  findings: ConsultantFinding[],
  answersByFindingIndex: Map<number, string>,
): ConsultantFinding[] {
  return findings.map((f, i) => {
    const answer = answersByFindingIndex.get(i);
    return answer ? { ...f, suggestion: `${f.suggestion}\n  Candidate's details: ${answer}` } : f;
  });
}

/**
 * Asks the model which findings need extra facts from the candidate before apply.
 * On failure, returns an empty list (caller proceeds without follow-up questions).
 */
export async function fetchConsultantFeedbackQuestions(
  findings: ConsultantFinding[],
  profileContext: string,
  signal?: AbortSignal,
): Promise<FeedbackQuestion[]> {
  try {
    const out = await callWithTool<FeedbackQuestionsOutput>(
      FEEDBACK_QUESTIONS_SYSTEM,
      buildFeedbackQuestionsPrompt(findings, profileContext),
      feedbackQuestionsTool,
      undefined,
      signal,
    );
    const qs = out.questions ?? [];
    return qs.map((q) => ({
      findingIndex: q.findingIndex,
      question: replaceEmDashes(q.question),
    }));
  } catch (err) {
    if (err instanceof APIUserAbortError || (err instanceof Error && err.name === 'AbortError')) {
      throw err;
    }
    return [];
  }
}

/**
 * Uses Claude to determine which selected findings require additional factual
 * information from the candidate (metrics, outcomes, team sizes, etc.) that
 * isn't already in the profile. Prompts the user only for those specific facts,
 * then returns findings enriched with the answers.
 */
export async function enrichFindingsWithUserInput(
  findings: ConsultantFinding[],
  inquirer: InquirerCLI,
  profileContext: string,
): Promise<ConsultantFinding[]> {
  const questions = await fetchConsultantFeedbackQuestions(findings, profileContext);
  if (questions.length === 0) return sanitizeConsultantFindings(findings);

  console.log(c.muted('\n  A few questions to fill in the details:'));

  const answers = new Map<number, string>();
  for (const q of questions) {
    const finding = findings[q.findingIndex];
    if (!finding) continue;

    console.log(`\n  ${chalk.bold(finding.area)}`);
    console.log(`  ${c.muted(finding.suggestion)}`);

    const { answer } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message: `  ${q.question}`,
      },
    ])) as { answer: string };

    if (answer.trim()) answers.set(q.findingIndex, answer.trim());
  }

  const merged = mergeConsultantFindingAnswers(findings, answers);
  return sanitizeConsultantFindings(merged);
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
  const output = await callWithTool<JobFeedbackOutput>(
    APPLY_JOB_FEEDBACK_SYSTEM,
    prompt,
    applyJobFeedbackTool,
  );

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

  return sanitizeResumeDocument(updated);
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
  console.log(`\n${chalk.bold.cyan(`─── Hiring Consultant Review ${'─'.repeat(40)}`)}`);
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
  console.log(`\n${chalk.bold.cyan(`─── Job Fit Review ${'─'.repeat(49)}`)}`);
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
