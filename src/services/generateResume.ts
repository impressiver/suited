import type { CuratorResult } from '../generate/curator.ts';
import { buildRefMapForProfile, curateForJob } from '../generate/curator.ts';
import { analyzeJobDescription } from '../generate/job-analyzer.ts';
import { trySqueeze } from '../generate/layoutSqueeze.ts';
import { polishResumeForJob } from '../generate/polisher.ts';
import { renderResumeHtml } from '../generate/renderer.ts';
import {
  assembleFullResumeDocument,
  assembleResumeDocument,
  getFlairInfo,
} from '../generate/resume-builder.ts';
import { autoTrimToFit } from '../generate/trimmer.ts';
import { exportToPdf, measurePageFit } from '../pdf/exporter.ts';
import { profileToMarkdown } from '../profile/markdown.ts';
import type {
  FlairLevel,
  GenerationConfig,
  JobAnalysis,
  JobRefinement,
  Profile,
  ResumeDocument,
  TemplateName,
} from '../profile/schema.ts';
import {
  jobRefinedMdPath,
  loadActiveProfile,
  loadJobRefinement,
  loadLogoCache,
  makeJobSlug,
  saveGenerationConfig,
  saveJobRefinedProfile,
  saveJobRefinement,
} from '../profile/serializer.ts';
import { selectAllSections } from './sectionSelection.ts';

export interface RunTuiGeneratePdfOptions {
  profileDir: string;
  resumesDir?: string;
  flair: FlairLevel;
  templateOverride?: TemplateName;
  jd?: string;
  jobId?: string;
  jobTitle?: string;
  company?: string;
}

export interface RunTuiGeneratePdfResult {
  outputPath: string;
  config: GenerationConfig;
}

function resumeDocToJobProfile(doc: ResumeDocument, base: Profile): Profile {
  const now = new Date().toISOString();
  const userEdit = (v: string) => ({
    value: v,
    source: { kind: 'user-edit' as const, editedAt: now },
  });

  const positions = doc.positions.map((rp) => {
    const basePos = base.positions.find(
      (p) => p.title.value === rp.title && p.company.value === rp.company,
    );
    return {
      id: basePos?.id ?? `pos-job-${rp.company.toLowerCase().replace(/\W+/g, '-')}`,
      title: basePos?.title ?? userEdit(rp.title),
      company: basePos?.company ?? userEdit(rp.company),
      location: rp.location ? (basePos?.location ?? userEdit(rp.location)) : undefined,
      startDate: basePos?.startDate ?? userEdit(rp.startDate),
      endDate: rp.endDate ? (basePos?.endDate ?? userEdit(rp.endDate)) : undefined,
      bullets: rp.bullets.map((b) => userEdit(b)),
    };
  });

  const skills = doc.skills.map((name, i) => {
    const baseSkill = base.skills.find((s) => s.name.value === name);
    return baseSkill ?? { id: `skill-job-${i}`, name: userEdit(name) };
  });

  const education = doc.education.map((re) => {
    const baseEdu = base.education.find((e) => e.institution.value === re.institution);
    return (
      baseEdu ?? {
        id: `edu-job-${re.institution.toLowerCase().replace(/\W+/g, '-')}`,
        institution: userEdit(re.institution),
        degree: re.degree ? userEdit(re.degree) : undefined,
        fieldOfStudy: re.fieldOfStudy ? userEdit(re.fieldOfStudy) : undefined,
      }
    );
  });

  return {
    ...base,
    updatedAt: now,
    summary: doc.summary ? userEdit(doc.summary) : undefined,
    positions,
    skills,
    education,
    certifications: doc.certifications.map((cert, i) => ({
      id: `cert-job-${i}`,
      name: userEdit(cert.name),
      authority: cert.authority ? userEdit(cert.authority) : undefined,
    })),
    projects: doc.projects.map((proj, i) => ({
      id: `proj-job-${i}`,
      title: userEdit(proj.title),
      description: proj.description ? userEdit(proj.description) : undefined,
      url: proj.url ? userEdit(proj.url) : undefined,
    })),
    languages: doc.languages.map((lang, i) => ({
      id: `lang-job-${i}`,
      name: userEdit(lang.name),
      proficiency: lang.proficiency ? userEdit(lang.proficiency) : undefined,
    })),
    volunteer: doc.volunteer.map((vol, i) => ({
      id: `vol-job-${i}`,
      organization: userEdit(vol.organization),
      role: vol.role ? userEdit(vol.role) : undefined,
      startDate: vol.startDate ? userEdit(vol.startDate) : undefined,
      endDate: vol.endDate ? userEdit(vol.endDate) : undefined,
    })),
    awards: doc.awards.map((a) => userEdit(a)),
    publications: [],
  };
}

function safeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function runTuiGeneratePdf(
  options: RunTuiGeneratePdfOptions,
): Promise<RunTuiGeneratePdfResult> {
  const profileDir = options.profileDir;
  const resumesDir = options.resumesDir ?? `${profileDir}/resumes`;
  const profile = await loadActiveProfile(profileDir);

  const nowIso = new Date().toISOString();
  const config: GenerationConfig = {
    createdAt: nowIso,
    updatedAt: nowIso,
    flair: options.flair,
    template: 'classic',
    templateOverride: options.templateOverride,
    jobTitle: options.jobTitle ?? 'Resume',
    company: options.company ?? '',
    jd: options.jd,
    jobId: options.jobId,
  };

  let resumeDoc: ResumeDocument;

  if (config.jd) {
    let jobAnalysis: JobAnalysis;
    let curatorResult: CuratorResult;

    const stored =
      options.jobId != null ? await loadJobRefinement(profileDir, options.jobId) : null;

    if (stored) {
      jobAnalysis = stored.jobAnalysis;
      curatorResult = { plan: stored.plan, refMap: buildRefMapForProfile(profile) };
    } else {
      try {
        jobAnalysis = await analyzeJobDescription(config.jd);
      } catch {
        jobAnalysis = {
          company: options.company ?? 'Unknown',
          title: options.jobTitle ?? 'Role',
          industry: 'general',
          seniority: 'mid',
          keySkills: [],
          mustHaves: [],
          niceToHaves: [],
          summary: config.jd.slice(0, 200),
        };
      }

      curatorResult = await curateForJob(profile, jobAnalysis);

      if (options.jobId) {
        const refinement: JobRefinement = {
          jobId: options.jobId,
          createdAt: new Date().toISOString(),
          jobAnalysis,
          plan: curatorResult.plan,
        };
        await saveJobRefinement(refinement, profileDir);
      }
    }

    config.jobAnalysis = jobAnalysis;
    config.company = jobAnalysis.company;
    config.jobTitle = jobAnalysis.title;

    const { effectiveFlair } = getFlairInfo(config.flair, jobAnalysis.industry);

    resumeDoc = assembleResumeDocument(
      profile,
      curatorResult.plan,
      curatorResult.refMap,
      effectiveFlair,
      jobAnalysis.industry,
      config.jobTitle,
      config.company,
    );

    resumeDoc = await polishResumeForJob(resumeDoc, jobAnalysis);

    const slug = makeJobSlug(config.company, config.jobTitle);
    const jobProfile = resumeDocToJobProfile(resumeDoc, profile);
    await Promise.all([
      saveJobRefinedProfile(jobProfile, profileDir, slug),
      profileToMarkdown(jobProfile, jobRefinedMdPath(profileDir, slug)),
    ]);
  } else {
    resumeDoc = assembleFullResumeDocument(profile, config);
    const { effectiveFlair } = getFlairInfo(config.flair, 'general');
    resumeDoc = { ...resumeDoc, flair: effectiveFlair };
  }

  if (options.templateOverride) {
    resumeDoc = { ...resumeDoc, template: options.templateOverride };
  }

  if (resumeDoc.template === 'timeline' && !resumeDoc.logoDataUris) {
    const cache = await loadLogoCache(profileDir);
    resumeDoc = { ...resumeDoc, logoDataUris: { ...cache } };
  }

  const sectioned = selectAllSections(resumeDoc);
  resumeDoc = sectioned.doc;
  config.sectionSelection = sectioned.selected;

  const personSlug = safeName(profile.contact.name.value);
  const fileBaseName = `${personSlug}-resume`;
  const outSlug = config.company ? makeJobSlug(config.company, config.jobTitle ?? '') : null;
  const resumeOutputDir = outSlug ? `${resumesDir}/${outSlug}` : resumesDir;

  const nowTs = new Date();
  const date = nowTs.toISOString().slice(0, 10);
  const hhmm = nowTs.toTimeString().slice(0, 5).replace(':', '');
  const outputPath = `${resumeOutputDir}/${fileBaseName}_${date}-${hhmm}.pdf`;

  let html = await renderResumeHtml(resumeDoc);
  html = await trySqueeze(html, resumeDoc);

  for (let step = 0; step < 6; step += 1) {
    const fit = await measurePageFit(html);
    if (!fit.overflows) {
      break;
    }
    resumeDoc = await autoTrimToFit(resumeDoc, fit.ratio);
    html = await renderResumeHtml(resumeDoc);
    html = await trySqueeze(html, resumeDoc);
  }

  await exportToPdf(html, { template: resumeDoc.template, outputPath });

  config.profileUpdatedAt = profile.updatedAt;
  config.resolvedTemplate = resumeDoc.template;
  await saveGenerationConfig(config, profileDir);

  return { outputPath, config };
}
