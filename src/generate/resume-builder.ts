import {
  Profile, CurationPlan, ResumeDocument, FlairLevel, TemplateName, IndustryVertical,
} from '../profile/schema.js';
import { resolvePath } from '../claude/accuracy-guard.js';
import { RefEntry } from '../claude/prompts/curate.js';

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
    email: profile.contact.email?.value,
    phone: profile.contact.phone?.value,
    location: profile.contact.location?.value,
    linkedin: profile.contact.linkedin?.value,
    website: profile.contact.website?.value,
    github: profile.contact.github?.value,
  };

  const summary = plan.summaryRef ? resolveRef(profile, refMap, plan.summaryRef) : undefined;

  const positions = plan.selectedPositions.map(selPos => {
    const pos = profile.positions.find(p => p.id === selPos.positionId);
    if (!pos) throw new Error(`Position "${selPos.positionId}" not found`);
    const bullets = selPos.bulletRefs.map(ref => resolveRef(profile, refMap, ref));
    return {
      title: pos.title.value,
      company: pos.company.value,
      location: pos.location?.value,
      startDate: pos.startDate.value,
      endDate: pos.endDate?.value,
      bullets,
    };
  });

  const education = plan.selectedEducationIds.map(eduId => {
    const edu = profile.education.find(e => e.id === eduId);
    if (!edu) throw new Error(`Education "${eduId}" not found`);
    return {
      institution: edu.institution.value,
      degree: edu.degree?.value,
      fieldOfStudy: edu.fieldOfStudy?.value,
      startDate: edu.startDate?.value,
      endDate: edu.endDate?.value,
    };
  });

  const skills = plan.selectedSkillIds.map(skillId => {
    const skill = profile.skills.find(s => s.id === skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found`);
    return skill.name.value;
  });

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
