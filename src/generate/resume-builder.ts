import {
  Profile, CurationPlan, ResumeDocument, ResumePosition, FlairLevel, TemplateName, IndustryVertical,
  GenerationConfig,
} from '../profile/schema.js';
import { resolvePath } from '../claude/accuracy-guard.js';
import { RefEntry } from '../claude/prompts/curate.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Converts "YYYY-MM" → "Mon YYYY". Passes through "YYYY" or other formats unchanged. */
function formatDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = date.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) return `${MONTH_ABBR[month - 1]} ${m[1]}`;
  }
  return date;
}

/** Ensures a URL has an https:// scheme so it works as an href. */
function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Strips country-only location strings (e.g. "United States") that add no useful context. */
function filterLocation(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const COUNTRY_ONLY = /^(United States|USA|US|United Kingdom|UK|Canada|Australia|Germany|France|India|China|Japan|Brazil|Mexico|Netherlands|Sweden|Norway|Denmark|Switzerland|New Zealand|Ireland|Singapore|South Korea|Spain|Italy|Portugal|Poland|Austria|Belgium|Finland|Israel|UAE|United Arab Emirates)$/i;
  return COUNTRY_ONLY.test(location.trim()) ? undefined : location;
}

// ---------------------------------------------------------------------------
// Role merging — consecutive positions at the same company collapse into one
// ---------------------------------------------------------------------------

/**
 * Merges runs of consecutive positions at the same company into a single entry.
 * Positions are assumed to be in most-recent-first order (standard resume order).
 * For each run: title = most recent role, dates = full span, bullets = all combined.
 */
function mergeConsecutiveRoles(positions: ResumePosition[]): ResumePosition[] {
  if (positions.length === 0) return [];
  const result: ResumePosition[] = [];
  let run: ResumePosition[] = [positions[0]];

  const flush = () => {
    if (run.length === 1) {
      result.push(run[0]);
    } else {
      // run[0] is the most recent; run[run.length-1] is the oldest
      result.push({
        title: run[0].title,
        company: run[0].company,
        location: run[0].location,
        startDate: run[run.length - 1].startDate,
        endDate: run[0].endDate,
        bullets: run.flatMap(p => p.bullets),
      });
    }
  };

  for (let i = 1; i < positions.length; i++) {
    if (positions[i].company.toLowerCase() === run[0].company.toLowerCase()) {
      run.push(positions[i]);
    } else {
      flush();
      run = [positions[i]];
    }
  }
  flush();
  return result;
}

// ---------------------------------------------------------------------------
// Template selection
// ---------------------------------------------------------------------------

const CONSERVATIVE_INDUSTRIES: IndustryVertical[] = ['academia', 'healthcare', 'legal'];

export function selectTemplate(flair: FlairLevel, industry: IndustryVertical): TemplateName {
  if (CONSERVATIVE_INDUSTRIES.includes(industry)) return 'classic';
  if (flair <= 2) return 'classic';
  if (flair <= 4) return 'modern';
  return 'bold';
}

export function getRecommendedFlair(industry: IndustryVertical): FlairLevel {
  if (CONSERVATIVE_INDUSTRIES.includes(industry)) return 1;
  if (industry === 'software-engineering') return 3;
  if (industry === 'design') return 4;
  if (industry === 'marketing') return 4;
  return 2;
}

/**
 * Returns a warning if the requested flair will be silently overridden.
 * Also returns the effective flair that will actually be used.
 */
export function getFlairInfo(
  requestedFlair: FlairLevel,
  industry: IndustryVertical,
): { effectiveFlair: FlairLevel; effectiveTemplate: TemplateName; warning: string | null } {
  const effectiveTemplate = selectTemplate(requestedFlair, industry);
  if (CONSERVATIVE_INDUSTRIES.includes(industry) && requestedFlair > 2) {
    return {
      effectiveFlair: 1,
      effectiveTemplate,
      warning: `${industry} roles conventionally use conservative formatting. Flair ${requestedFlair} → classic template (flair 1).`,
    };
  }
  return { effectiveFlair: requestedFlair, effectiveTemplate, warning: null };
}

// ---------------------------------------------------------------------------
// Resolver helpers
// ---------------------------------------------------------------------------

function resolveRef(
  profile: Profile,
  refMap: Map<string, RefEntry>,
  refId: string,
): string {
  const entry = refMap.get(refId);
  if (!entry) throw new Error(`Cannot resolve ref "${refId}" — not in refMap`);
  const val = resolvePath(profile, entry.path);
  if (!val) throw new Error(`Path "${entry.path}" did not resolve (ref "${refId}")`);
  return val;
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export function assembleResumeDocument(
  profile: Profile,
  plan: CurationPlan,
  refMap: Map<string, RefEntry>,
  flair: FlairLevel,
  industry: IndustryVertical,
  jobTitle: string,
  company: string,
): ResumeDocument {
  const template = selectTemplate(flair, industry);

  const contact = {
    name: profile.contact.name.value,
    headline: profile.contact.headline?.value,
    email: profile.contact.email?.value,
    phone: profile.contact.phone?.value,
    location: filterLocation(profile.contact.location?.value),
    linkedin: normalizeUrl(profile.contact.linkedin?.value),
    website: normalizeUrl(profile.contact.website?.value),
    github: normalizeUrl(profile.contact.github?.value),
  };

  const summary = plan.summaryRef ? resolveRef(profile, refMap, plan.summaryRef) : undefined;

  const positions = mergeConsecutiveRoles(
    plan.selectedPositions.map(selPos => {
      const pos = profile.positions.find(p => p.id === selPos.positionId);
      if (!pos) throw new Error(`Position "${selPos.positionId}" not found`);
      const bullets = selPos.bulletRefs.map(ref => resolveRef(profile, refMap, ref));
      return {
        title: pos.title.value,
        company: pos.company.value,
        location: filterLocation(pos.location?.value),
        startDate: formatDate(pos.startDate.value)!,
        endDate: formatDate(pos.endDate?.value),
        bullets,
      };
    }),
  );

  const education = plan.selectedEducationIds.map(eduId => {
    const edu = profile.education.find(e => e.id === eduId);
    if (!edu) throw new Error(`Education "${eduId}" not found`);
    return {
      institution: edu.institution.value,
      degree: edu.degree?.value,
      fieldOfStudy: edu.fieldOfStudy?.value,
      startDate: formatDate(edu.startDate?.value),
      endDate: formatDate(edu.endDate?.value),
    };
  });

  // Filter out stale skill IDs (e.g. after replacedSkills renames them to skill-refined-*)
  const resolvedSkills = plan.selectedSkillIds
    .map(skillId => profile.skills.find(s => s.id === skillId))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const skills = (resolvedSkills.length > 0 ? resolvedSkills : profile.skills).map(s => s.name.value);

  const projects = plan.selectedProjectIds.map(projId => {
    const proj = profile.projects.find(p => p.id === projId);
    if (!proj) throw new Error(`Project "${projId}" not found`);
    return {
      title: proj.title.value,
      description: proj.description?.value,
      url: proj.url?.value,
    };
  });

  // Certifications — curated by selectedCertificationIds
  const certifications = plan.selectedCertificationIds.map(certId => {
    const cert = profile.certifications.find(c => c.id === certId);
    if (!cert) throw new Error(`Certification "${certId}" not found`);
    return {
      name: cert.name.value,
      authority: cert.authority?.value,
      date: cert.startDate?.value,
    };
  });

  // Languages — always include all (not curated; short list, always relevant)
  const languages = profile.languages.map(l => ({
    name: l.name.value,
    proficiency: l.proficiency?.value,
  }));

  // Volunteer — always include all
  const volunteer = profile.volunteer.map(v => ({
    organization: v.organization.value,
    role: v.role?.value,
    startDate: v.startDate?.value,
    endDate: v.endDate?.value,
  }));

  // Awards — always include all
  const awards = profile.awards.map(a => a.value);

  return {
    contact,
    summary,
    positions,
    education,
    skills,
    projects,
    certifications,
    languages,
    volunteer,
    awards,
    flair,
    template,
    jobTitle,
    company,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Full assembler — includes all profile data, no curation
// ---------------------------------------------------------------------------

export function assembleFullResumeDocument(
  profile: Profile,
  config: GenerationConfig,
): ResumeDocument {
  const { effectiveFlair, effectiveTemplate } = getFlairInfo(
    config.flair,
    config.jobAnalysis?.industry ?? 'general',
  );

  const contact = {
    name: profile.contact.name.value,
    headline: profile.contact.headline?.value,
    email: profile.contact.email?.value,
    phone: profile.contact.phone?.value,
    location: filterLocation(profile.contact.location?.value),
    linkedin: normalizeUrl(profile.contact.linkedin?.value),
    website: normalizeUrl(profile.contact.website?.value),
    github: normalizeUrl(profile.contact.github?.value),
  };

  return {
    contact,
    summary: profile.summary?.value,
    positions: mergeConsecutiveRoles(profile.positions.map(pos => ({
      title: pos.title.value,
      company: pos.company.value,
      location: filterLocation(pos.location?.value),
      startDate: formatDate(pos.startDate.value)!,
      endDate: formatDate(pos.endDate?.value),
      bullets: pos.bullets.map(b => b.value),
    }))),
    education: profile.education.map(edu => ({
      institution: edu.institution.value,
      degree: edu.degree?.value,
      fieldOfStudy: edu.fieldOfStudy?.value,
      startDate: formatDate(edu.startDate?.value),
      endDate: formatDate(edu.endDate?.value),
    })),
    skills: profile.skills.map(s => s.name.value),
    projects: profile.projects.map(p => ({
      title: p.title.value,
      description: p.description?.value,
      url: p.url?.value,
    })),
    certifications: profile.certifications.map(c => ({
      name: c.name.value,
      authority: c.authority?.value,
      date: c.startDate?.value,
    })),
    languages: profile.languages.map(l => ({
      name: l.name.value,
      proficiency: l.proficiency?.value,
    })),
    volunteer: profile.volunteer.map(v => ({
      organization: v.organization.value,
      role: v.role?.value,
      startDate: v.startDate?.value,
      endDate: v.endDate?.value,
    })),
    awards: profile.awards.map(a => a.value),
    flair: effectiveFlair,
    template: effectiveTemplate,
    // When no JD is provided and the user left the title as the default "Resume",
    // fall back to the contact headline, then the most recent position title.
    jobTitle: (config.jobTitle === 'Resume' || !config.jobTitle)
      ? (profile.contact.headline?.value ?? profile.positions[0]?.title.value ?? config.jobTitle)
      : config.jobTitle,
    company: config.company,
    generatedAt: new Date().toISOString(),
  };
}
