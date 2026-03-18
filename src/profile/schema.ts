import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provenance / data source
// ---------------------------------------------------------------------------

export type DataSource =
  | { kind: 'linkedin-export'; file: string; field: string }
  | { kind: 'linkedin-paste'; extractedBy: 'claude'; inputHash: string }
  | { kind: 'user-edit'; editedAt: string };

export interface Sourced<T> {
  value: T;
  source: DataSource;
}

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

export interface ContactInfo {
  name: Sourced<string>;
  headline?: Sourced<string>;  // current professional title / tagline
  email?: Sourced<string>;
  phone?: Sourced<string>;
  location?: Sourced<string>;
  linkedin?: Sourced<string>;
  website?: Sourced<string>;
  github?: Sourced<string>;
}

export interface Position {
  id: string;                          // e.g. "pos-0", "pos-1"
  title: Sourced<string>;
  company: Sourced<string>;
  location?: Sourced<string>;
  startDate: Sourced<string>;          // normalized to YYYY-MM or YYYY
  endDate?: Sourced<string>;           // undefined = present
  description?: Sourced<string>;       // raw description from LinkedIn
  bullets: Sourced<string>[];          // split from description
}

export interface Education {
  id: string;
  institution: Sourced<string>;
  degree?: Sourced<string>;
  fieldOfStudy?: Sourced<string>;
  startDate?: Sourced<string>;
  endDate?: Sourced<string>;
  activities?: Sourced<string>;
  notes?: Sourced<string>;
}

export interface Skill {
  id: string;
  name: Sourced<string>;
}

export interface Certification {
  id: string;
  name: Sourced<string>;
  authority?: Sourced<string>;
  startDate?: Sourced<string>;
  endDate?: Sourced<string>;
  licenseNumber?: Sourced<string>;
  url?: Sourced<string>;
}

export interface Project {
  id: string;
  title: Sourced<string>;
  description?: Sourced<string>;
  url?: Sourced<string>;
  startDate?: Sourced<string>;
  endDate?: Sourced<string>;
}

export interface Publication {
  id: string;
  title: Sourced<string>;
  publisher?: Sourced<string>;
  publishedOn?: Sourced<string>;
  description?: Sourced<string>;
  url?: Sourced<string>;
}

export interface Language {
  id: string;
  name: Sourced<string>;
  proficiency?: Sourced<string>;
}

export interface VolunteerRole {
  id: string;
  organization: Sourced<string>;
  role?: Sourced<string>;
  cause?: Sourced<string>;
  startDate?: Sourced<string>;
  endDate?: Sourced<string>;
  description?: Sourced<string>;
}

// ---------------------------------------------------------------------------
// Top-level profile
// ---------------------------------------------------------------------------

export interface Profile {
  schemaVersion: '1';
  createdAt: string;
  updatedAt: string;
  contact: ContactInfo;
  summary?: Sourced<string>;
  positions: Position[];
  education: Education[];
  skills: Skill[];
  certifications: Certification[];
  projects: Project[];
  publications: Publication[];
  languages: Language[];
  volunteer: VolunteerRole[];
  awards: Sourced<string>[];
}

// ---------------------------------------------------------------------------
// Job analysis
// ---------------------------------------------------------------------------

export type IndustryVertical =
  | 'software-engineering'
  | 'finance'
  | 'design'
  | 'marketing'
  | 'consulting'
  | 'academia'
  | 'healthcare'
  | 'legal'
  | 'general'
  | 'ai';

export type SeniorityLevel =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'architect'
  | 'manager'
  | 'director'
  | 'vp'
  | 'c-level';

export interface JobAnalysis {
  company: string;
  title: string;
  industry: IndustryVertical;
  seniority: SeniorityLevel;
  keySkills: string[];
  mustHaves: string[];
  niceToHaves: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Curation
// ---------------------------------------------------------------------------

export type FlairLevel = 1 | 2 | 3 | 4 | 5;
export type TemplateName = 'classic' | 'modern' | 'bold' | 'retro' | 'timeline';

export interface CuratedPosition {
  positionId: string;
  bulletRefs: string[];  // stable IDs like "b:pos-0:2" — validated by accuracy guard
}

export interface CurationPlan {
  selectedPositions: CuratedPosition[];
  selectedSkillIds: string[];
  selectedProjectIds: string[];
  selectedEducationIds: string[];
  selectedCertificationIds: string[];
  summaryRef: string | null;   // "summary" or null
}

// ---------------------------------------------------------------------------
// Resume document (fully resolved, ready to render)
// ---------------------------------------------------------------------------

export interface ResumePosition {
  title: string;
  company: string;
  location?: string;
  startDate: string;
  endDate?: string;
  bullets: string[];
}

export interface ResumeEducation {
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
}

export interface ResumeDocument {
  contact: {
    name: string;
    headline?: string;  // current professional title / tagline
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
    github?: string;
  };
  summary?: string;
  positions: ResumePosition[];
  education: ResumeEducation[];
  skills: string[];
  projects: Array<{ title: string; description?: string; url?: string }>;
  certifications: Array<{ name: string; authority?: string; date?: string }>;
  languages: Array<{ name: string; proficiency?: string }>;
  volunteer: Array<{ organization: string; role?: string; startDate?: string; endDate?: string }>;
  awards: string[];
  flair: FlairLevel;
  template: TemplateName;
  jobTitle: string;
  company: string;
  generatedAt: string;
  /** Pre-fetched logo data URIs keyed by company/institution name (timeline template). */
  logoDataUris?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

const DataSourceSchema = z.union([
  z.object({ kind: z.literal('linkedin-export'), file: z.string(), field: z.string() }),
  z.object({ kind: z.literal('linkedin-paste'), extractedBy: z.literal('claude'), inputHash: z.string() }),
  z.object({ kind: z.literal('user-edit'), editedAt: z.string() }),
]);

function sourced<T extends z.ZodType>(schema: T) {
  return z.object({ value: schema, source: DataSourceSchema });
}

const PositionSchema: z.ZodType<Position> = z.object({
  id: z.string(),
  title: sourced(z.string()),
  company: sourced(z.string()),
  location: sourced(z.string()).optional(),
  startDate: sourced(z.string()),
  endDate: sourced(z.string()).optional(),
  description: sourced(z.string()).optional(),
  bullets: z.array(sourced(z.string())),
});

const EducationSchema: z.ZodType<Education> = z.object({
  id: z.string(),
  institution: sourced(z.string()),
  degree: sourced(z.string()).optional(),
  fieldOfStudy: sourced(z.string()).optional(),
  startDate: sourced(z.string()).optional(),
  endDate: sourced(z.string()).optional(),
  activities: sourced(z.string()).optional(),
  notes: sourced(z.string()).optional(),
});

export const ProfileSchema: z.ZodType<Profile> = z.object({
  schemaVersion: z.literal('1'),
  createdAt: z.string(),
  updatedAt: z.string(),
  contact: z.object({
    name: sourced(z.string()),
    headline: sourced(z.string()).optional(),
    email: sourced(z.string()).optional(),
    phone: sourced(z.string()).optional(),
    location: sourced(z.string()).optional(),
    linkedin: sourced(z.string()).optional(),
    website: sourced(z.string()).optional(),
    github: sourced(z.string()).optional(),
  }),
  summary: sourced(z.string()).optional(),
  positions: z.array(PositionSchema),
  education: z.array(EducationSchema),
  skills: z.array(z.object({ id: z.string(), name: sourced(z.string()) })),
  certifications: z.array(z.object({
    id: z.string(),
    name: sourced(z.string()),
    authority: sourced(z.string()).optional(),
    startDate: sourced(z.string()).optional(),
    endDate: sourced(z.string()).optional(),
    licenseNumber: sourced(z.string()).optional(),
    url: sourced(z.string()).optional(),
  })),
  projects: z.array(z.object({
    id: z.string(),
    title: sourced(z.string()),
    description: sourced(z.string()).optional(),
    url: sourced(z.string()).optional(),
    startDate: sourced(z.string()).optional(),
    endDate: sourced(z.string()).optional(),
  })),
  publications: z.array(z.object({
    id: z.string(),
    title: sourced(z.string()),
    publisher: sourced(z.string()).optional(),
    publishedOn: sourced(z.string()).optional(),
    description: sourced(z.string()).optional(),
    url: sourced(z.string()).optional(),
  })),
  languages: z.array(z.object({
    id: z.string(),
    name: sourced(z.string()),
    proficiency: sourced(z.string()).optional(),
  })),
  volunteer: z.array(z.object({
    id: z.string(),
    organization: sourced(z.string()),
    role: sourced(z.string()).optional(),
    cause: sourced(z.string()).optional(),
    startDate: sourced(z.string()).optional(),
    endDate: sourced(z.string()).optional(),
    description: sourced(z.string()).optional(),
  })),
  awards: z.array(sourced(z.string())),
});

export const CurationPlanSchema: z.ZodType<CurationPlan> = z.object({
  selectedPositions: z.array(z.object({
    positionId: z.string(),
    bulletRefs: z.array(z.string()),
  })),
  selectedSkillIds: z.array(z.string()),
  selectedProjectIds: z.array(z.string()),
  selectedEducationIds: z.array(z.string()),
  selectedCertificationIds: z.array(z.string()),
  summaryRef: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Refinement session (phase 2)
// ---------------------------------------------------------------------------

export interface RefinementQuestion {
  id: string;
  /** Position id, "summary", "skills", etc. */
  targetId: string;
  /** Brief framing, e.g. "Senior Engineer at Acme Corp (2020–2022)" */
  context: string;
  question: string;
  optional: boolean;
}

export interface RefinementSession {
  conductedAt: string;
  /** SHA-256 of source.json used to detect if source has changed since last refine */
  sourceHash: string;
  questions: RefinementQuestion[];
  /** Map of question id → user's answer */
  answers: Record<string, string>;
}

export interface RefinedData {
  profile: Profile;
  session: RefinementSession;
}

// ---------------------------------------------------------------------------
// Persistent contact metadata — survives re-imports
// ---------------------------------------------------------------------------

/** Plain-string contact fields entered by the user, persisted in contact.json. */
export interface ContactMeta {
  headline?: string;  // current professional title / tagline
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  website?: string;
  github?: string;
}

// ---------------------------------------------------------------------------
// Job refinements — per-job curation plan, stored for reuse
// ---------------------------------------------------------------------------

export interface JobRefinement {
  jobId: string;
  createdAt: string;
  jobAnalysis: JobAnalysis;
  plan: CurationPlan;
}

// ---------------------------------------------------------------------------
// Generation config (phase 3)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Saved job descriptions
// ---------------------------------------------------------------------------

export interface SavedJob {
  id: string;
  company: string;
  title: string;
  savedAt: string;
  text: string;
  /** SHA-256 of text — used to avoid saving duplicates */
  textHash: string;
}

// ---------------------------------------------------------------------------

export interface GenerationConfig {
  createdAt: string;
  updatedAt: string;
  flair: FlairLevel;
  template: TemplateName;
  /** When set, overrides the flair-based template selection (e.g. 'retro') */
  templateOverride?: TemplateName;
  /** When true, generate one PDF per template instead of a single file */
  allTemplates?: boolean;
  /** ID of the saved job this config was generated for — links to a JobRefinement */
  jobId?: string;
  jobTitle: string;
  company: string;
  jd?: string;
  jobAnalysis?: JobAnalysis;
  /** profile.updatedAt at the time this config was saved — detects stale configs */
  profileUpdatedAt?: string;
  /** Section/position selections from the last selectSections call — used to restore defaults on reuse */
  sectionSelection?: string[];
}
