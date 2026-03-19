import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';

export const ANALYZE_JD_SYSTEM = `You are a job description analyst. Extract structured information from job postings accurately.`;

export const analyzeJdTool: Tool = {
  name: 'analyze_job_description',
  description: 'Extract structured data from a job description',
  input_schema: {
    type: 'object' as const,
    required: [
      'company',
      'title',
      'industry',
      'seniority',
      'keySkills',
      'mustHaves',
      'niceToHaves',
      'summary',
    ],
    properties: {
      company: { type: 'string', description: 'Company name' },
      title: { type: 'string', description: 'Job title' },
      industry: {
        type: 'string',
        enum: [
          'software-engineering',
          'finance',
          'design',
          'marketing',
          'consulting',
          'academia',
          'healthcare',
          'legal',
          'general',
          'ai',
        ],
        description: 'Industry vertical',
      },
      seniority: {
        type: 'string',
        enum: [
          'intern',
          'junior',
          'mid',
          'senior',
          'staff',
          'principal',
          'lead',
          'architect',
          'manager',
          'director',
          'vp',
          'c-level',
        ],
        description: 'Seniority level inferred from title and requirements',
      },
      keySkills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technical and soft skills mentioned in the JD',
      },
      mustHaves: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required qualifications (required/must have)',
      },
      niceToHaves: {
        type: 'array',
        items: { type: 'string' },
        description: 'Preferred/nice-to-have qualifications',
      },
      summary: {
        type: 'string',
        description: 'One-sentence summary of the role',
      },
    },
  },
};
