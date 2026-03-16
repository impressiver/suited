import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';

export const PARSE_LINKEDIN_SYSTEM = `You are a data extraction assistant. Your ONLY job is to extract information verbatim from the LinkedIn profile text the user provides.

STRICT RULES:
1. Extract ONLY text that is explicitly present in the input. Do NOT infer, paraphrase, or add information.
2. If a field is not present in the input, omit it entirely (do not use null/empty string).
3. For bullets/descriptions: copy the exact text from the profile, do not rephrase.
4. For dates: copy as-is from the text (normalization happens downstream).
5. Do not add context, skills not mentioned, or achievements not stated.`;

export const parseLinkedInTool: Tool = {
  name: 'extract_linkedin_profile',
  description: 'Extract structured profile data verbatim from LinkedIn profile text',
  input_schema: {
    type: 'object' as const,
    required: ['contact'],
    properties: {
      contact: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Full name exactly as in profile' },
          email: { type: 'string' },
          phone: { type: 'string' },
          location: { type: 'string' },
          linkedin: { type: 'string' },
          website: { type: 'string' },
          github: { type: 'string' },
        },
      },
      summary: { type: 'string', description: 'Verbatim summary/about section text' },
      positions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'company', 'startDate'],
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            description: { type: 'string', description: 'Verbatim job description/bullets' },
          },
        },
      },
      education: {
        type: 'array',
        items: {
          type: 'object',
          required: ['institution'],
          properties: {
            institution: { type: 'string' },
            degree: { type: 'string' },
            fieldOfStudy: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            activities: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skill names verbatim',
      },
      certifications: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            authority: { type: 'string' },
            date: { type: 'string' },
          },
        },
      },
      projects: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string' },
          },
        },
      },
      publications: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            publisher: { type: 'string' },
            publishedOn: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string' },
          },
        },
      },
      languages: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            proficiency: { type: 'string' },
          },
        },
      },
      volunteer: {
        type: 'array',
        items: {
          type: 'object',
          required: ['organization'],
          properties: {
            organization: { type: 'string' },
            role: { type: 'string' },
            cause: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
        },
      },
    },
  },
};

export type ParsedLinkedInProfile = {
  contact: {
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
    github?: string;
  };
  summary?: string;
  positions?: Array<{
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    description?: string;
  }>;
  education?: Array<{
    institution: string;
    degree?: string;
    fieldOfStudy?: string;
    startDate?: string;
    endDate?: string;
    activities?: string;
    notes?: string;
  }>;
  skills?: string[];
  certifications?: Array<{ name: string; authority?: string; date?: string }>;
  projects?: Array<{ title: string; description?: string; url?: string }>;
  publications?: Array<{
    title: string;
    publisher?: string;
    publishedOn?: string;
    description?: string;
    url?: string;
  }>;
  languages?: Array<{ name: string; proficiency?: string }>;
  volunteer?: Array<{
    organization: string;
    role?: string;
    cause?: string;
    startDate?: string;
    endDate?: string;
  }>;
};
