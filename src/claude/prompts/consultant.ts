import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { JobAnalysis, ResumeDocument } from '../../profile/schema.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ConsultantFinding {
  area: string; // e.g. "Summary", "Experience bullets", "Skills section"
  issue: string; // what's wrong
  suggestion: string; // concrete fix
}

// ---------------------------------------------------------------------------
// Profile evaluation
// ---------------------------------------------------------------------------

export const PROFILE_CONSULTANT_SYSTEM = `You are a senior hiring consultant with 20 years of experience reviewing resumes for competitive roles at top companies. You have seen thousands of resumes and know exactly what makes candidates stand out or get screened out.

Your job: give honest, specific, actionable feedback. Be direct — flag real problems. Don't inflate scores or give empty praise. Only highlight strengths that are genuinely strong.

Focus areas:
- Impact and quantification in experience bullets
- Clarity and quality of the professional summary
- Skills relevance and presentation
- Career narrative and progression
- Overall first impression for a recruiter who spends 10 seconds scanning

Do NOT comment on formatting, fonts, or visual design — only content.`;

export interface ProfileEvaluation {
  overallScore: number;
  strengths: string[];
  improvements: ConsultantFinding[];
  verdict: string;
}

export const profileEvalTool: Tool = {
  name: 'evaluate_profile',
  description: 'Evaluate a resume profile and return structured feedback',
  input_schema: {
    type: 'object' as const,
    required: ['overallScore', 'strengths', 'improvements', 'verdict'],
    properties: {
      overallScore: {
        type: 'number',
        description:
          'Overall score 1–10. 7 = solid but improvable. 8+ = genuinely strong. Below 6 = significant work needed.',
      },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific things that are working well. Be concrete — not just "good experience".',
      },
      improvements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['area', 'issue', 'suggestion'],
          properties: {
            area: {
              type: 'string',
              description: 'Section or element (e.g. "Summary", "Bullet #3 at Acme Corp")',
            },
            issue: { type: 'string', description: 'Specific problem — what is weak or missing' },
            suggestion: { type: 'string', description: 'Concrete actionable fix' },
          },
        },
        description: 'Only real issues. Omit if nothing is wrong in an area.',
      },
      verdict: {
        type: 'string',
        description: 'One to two sentence overall assessment. Honest and direct.',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Job-tailored evaluation
// ---------------------------------------------------------------------------

export const JOB_CONSULTANT_SYSTEM = `You are a hiring manager and senior resume consultant reviewing a candidate's tailored resume for a specific job opening. You know this role's requirements well and are evaluating whether this resume would make the cut.

Your job: assess how well the resume is positioned for this specific role. Be specific. Identify real gaps between what the role requires and what the resume shows. Flag missing keywords, weak positioning, or missed opportunities to highlight relevant experience.

Do NOT comment on formatting or visual design — only content alignment with the job.`;

export interface JobEvaluation {
  alignmentScore: number;
  strengths: string[];
  gaps: ConsultantFinding[];
  verdict: string;
}

export const jobEvalTool: Tool = {
  name: 'evaluate_job_alignment',
  description: 'Evaluate how well a resume is tailored for a specific job',
  input_schema: {
    type: 'object' as const,
    required: ['alignmentScore', 'strengths', 'gaps', 'verdict'],
    properties: {
      alignmentScore: {
        type: 'number',
        description:
          'Alignment score 1–10. How likely is a recruiter to advance this candidate based on the resume alone.',
      },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific ways the resume aligns with the job requirements.',
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          required: ['area', 'issue', 'suggestion'],
          properties: {
            area: {
              type: 'string',
              description:
                'Area of concern (e.g. "Missing skill", "Summary positioning", "Seniority signals")',
            },
            issue: { type: 'string', description: 'What is missing or misaligned' },
            suggestion: { type: 'string', description: 'How to address it' },
          },
        },
        description: 'Only real alignment gaps. Omit if nothing is missing.',
      },
      verdict: {
        type: 'string',
        description: 'One to two sentence verdict on candidacy strength for this role.',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Question generation — determine what info is needed before applying feedback
// ---------------------------------------------------------------------------

export const FEEDBACK_QUESTIONS_SYSTEM = `You are a resume assistant helping a candidate incorporate consultant feedback into their resume.

Your job: given a list of consultant findings the candidate wants to apply, determine which ones require additional factual information from the candidate that isn't already present in the profile.

Only generate a question when implementing the suggestion genuinely requires a specific fact the candidate must supply — such as a metric, outcome, team size, timeframe, technology name, dollar amount, or concrete result.

Do NOT generate questions for findings that:
- Can be addressed using only the information already in the profile
- Are structural or stylistic changes (reordering, rephrasing, removing content)
- Ask for something the profile already contains

Be precise: ask for the specific fact needed, not a vague "more details."`;

export interface FeedbackQuestion {
  findingIndex: number; // 0-based index into the findings array
  question: string; // specific question to ask the candidate
}

export interface FeedbackQuestionsOutput {
  questions: FeedbackQuestion[];
}

export const feedbackQuestionsTool: Tool = {
  name: 'identify_needed_info',
  description:
    'Identify which findings need additional factual info from the candidate, and what to ask',
  input_schema: {
    type: 'object' as const,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['findingIndex', 'question'],
          properties: {
            findingIndex: {
              type: 'number',
              description: '0-based index of the finding that needs more info',
            },
            question: {
              type: 'string',
              description: 'Specific question to ask the candidate — what fact is needed',
            },
          },
        },
        description: 'Empty array if no findings need additional information',
      },
    },
  },
};

export function buildFeedbackQuestionsPrompt(
  findings: ConsultantFinding[],
  profileContext: string,
): string {
  const lines = [profileContext, '\n## Consultant Findings to Apply'];
  findings.forEach((f, i) => {
    lines.push(`\n[${i}] **${f.area}**`);
    lines.push(`  Issue: ${f.issue}`);
    lines.push(`  Suggestion: ${f.suggestion}`);
  });
  lines.push(
    '\nFor each finding above, determine if you need a specific fact from the candidate to implement it. Return questions only for findings that genuinely require new information.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Applying profile feedback (reuses refinements tool from refine.ts)
// ---------------------------------------------------------------------------

export const APPLY_PROFILE_FEEDBACK_SYSTEM = `You are a resume writer applying specific improvements identified by a hiring consultant.

Apply ONLY the changes described in the consultant's findings below. Do not make other changes.
Do not add any fact, metric, or technology not already present in the original profile.
Match the candidate's voice — write how a person writes, not a press release.`;

export function buildProfileFeedbackPrompt(
  profileText: string,
  findings: ConsultantFinding[],
): string {
  const lines = [profileText, '\n## Consultant Findings to Apply'];
  findings.forEach((f, i) => {
    lines.push(`\n${i + 1}. **${f.area}**`);
    lines.push(`   Issue: ${f.issue}`);
    lines.push(`   Fix: ${f.suggestion}`);
  });
  lines.push('\nApply these specific improvements to the profile.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Applying job feedback to a rendered ResumeDocument
// ---------------------------------------------------------------------------

export const APPLY_JOB_FEEDBACK_SYSTEM = `You are a resume writer applying targeted improvements to better position a candidate for a specific job.

Apply ONLY the changes described in the consultant's gap findings. Do not make other changes.
Do not add any fact, technology, or metric not already present in the resume.
Match the candidate's existing voice and writing style.`;

export interface JobFeedbackOutput {
  positions: Array<{ index: number; bullets: string[] }>;
  summary?: string;
  skills?: string[];
}

export const applyJobFeedbackTool: Tool = {
  name: 'apply_job_feedback',
  description:
    'Apply consultant gap findings to improve job alignment. Only return fields that changed.',
  input_schema: {
    type: 'object' as const,
    required: ['positions'],
    properties: {
      positions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['index', 'bullets'],
          properties: {
            index: { type: 'number', description: 'Zero-based position index' },
            bullets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Full updated bullet list',
            },
          },
        },
        description: 'Only include positions where bullets changed',
      },
      summary: { type: 'string', description: 'Updated summary if it changed, omit if unchanged' },
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Full updated skills list if it changed, omit if unchanged',
      },
    },
  },
};

export function buildJobFeedbackPrompt(
  doc: ResumeDocument,
  jobAnalysis: JobAnalysis,
  gaps: ConsultantFinding[],
): string {
  const lines: string[] = [];

  lines.push('## Gap Findings to Address');
  gaps.forEach((g, i) => {
    lines.push(`${i + 1}. **${g.area}**: ${g.issue}`);
    lines.push(`   Fix: ${g.suggestion}`);
  });

  lines.push('\n## Resume');
  if (doc.summary) {
    lines.push(`\nSummary:\n${doc.summary}`);
  }

  lines.push('\n## Experience (indexed from 0)');
  doc.positions.forEach((pos, i) => {
    lines.push(`\n[${i}] ${pos.title} at ${pos.company}`);
    for (const b of pos.bullets) {
      lines.push(`  • ${b}`);
    }
  });

  if (doc.skills.length > 0) {
    lines.push('\n## Skills');
    lines.push(doc.skills.join(', '));
  }

  lines.push(`\n## Target Role\n${jobAnalysis.title} at ${jobAnalysis.company}`);
  lines.push(`Key skills: ${jobAnalysis.keySkills.join(', ')}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Resume document serialisation for consultant prompts
// ---------------------------------------------------------------------------

export function resumeDocToConsultantText(doc: ResumeDocument, jobAnalysis: JobAnalysis): string {
  const lines: string[] = [];

  lines.push(`## Job: ${jobAnalysis.title} at ${jobAnalysis.company}`);
  lines.push(`Industry: ${jobAnalysis.industry}  |  Seniority: ${jobAnalysis.seniority}`);
  lines.push(`Must-haves: ${jobAnalysis.mustHaves.join(', ') || 'none listed'}`);
  lines.push(`Key skills required: ${jobAnalysis.keySkills.join(', ') || 'none listed'}`);
  lines.push(`Nice-to-haves: ${jobAnalysis.niceToHaves.join(', ') || 'none'}`);
  lines.push(`Job summary: ${jobAnalysis.summary}`);

  lines.push('\n## Resume');
  lines.push(`Candidate: ${doc.contact.name}`);
  if (doc.contact.headline) lines.push(`Headline: ${doc.contact.headline}`);
  if (doc.summary) lines.push(`\nSummary: ${doc.summary}`);

  if (doc.positions.length > 0) {
    lines.push('\n### Experience');
    for (const pos of doc.positions) {
      const dates = [pos.startDate, pos.endDate || 'Present'].join(' – ');
      lines.push(`\n${pos.title} at ${pos.company}  (${dates})`);
      for (const b of pos.bullets) lines.push(`  • ${b}`);
    }
  }

  if (doc.skills.length > 0) {
    lines.push('\n### Skills');
    lines.push(doc.skills.join(', '));
  }

  if (doc.education.length > 0) {
    lines.push('\n### Education');
    for (const edu of doc.education) {
      const deg = [edu.degree, edu.fieldOfStudy].filter(Boolean).join(' in ');
      lines.push(`  ${edu.institution}${deg ? ` — ${deg}` : ''}`);
    }
  }

  return lines.join('\n');
}
