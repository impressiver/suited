import type { CuratorResult } from '../generate/curator.ts';
import { buildRefMapForProfile, curateForJob } from '../generate/curator.ts';
import { analyzeJobDescription } from '../generate/job-analyzer.ts';
import { renderWithSqueeze } from '../generate/layoutSqueeze.ts';
import { polishResumeForJob } from '../generate/polisher.ts';
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
import { throwIfAborted } from '../utils/abort.ts';
import { persistJobRefinementPinnedRender } from './jobRefinement.ts';
import { applyResumeSectionSelection, collectDefaultSectionKeys } from './sectionSelection.ts';

export interface RunTuiGeneratePdfOptions {
  profileDir: string;
  resumesDir?: string;
  flair: FlairLevel;
  templateOverride?: TemplateName;
  jd?: string;
  jobId?: string;
  jobTitle?: string;
  company?: string;
  /** Checked between major pipeline steps (not mid–single Claude call). */
  signal?: AbortSignal;
  /**
   * UI progress: active step index (see `GenerateScreen` labels). Job path: 0…5; full resume: 0…4.
   */
  onProgress?: (stepIndex: number) => void;
}

export interface RunTuiGeneratePdfResult {
  outputPath: string;
  config: GenerationConfig;
}

/** Result of analyze / assemble / polish — before section checkboxes. TUI shows sections, then calls `runTuiGenerateRenderPhase`. */
export interface TuiGenerateBuiltState {
  profile: Profile;
  resumeDocFull: ResumeDocument;
  config: GenerationConfig;
  storedJobRefinement: JobRefinement | null;
  resumesDir: string;
  profileDir: string;
  flair: FlairLevel;
  templateOverride?: TemplateName;
  jobId?: string;
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

/**
 * Analyze/curate/assemble/polish (job path) or full-document build — stops before section selection.
 */
export async function runTuiGenerateBuildPhase(
  options: RunTuiGeneratePdfOptions,
): Promise<TuiGenerateBuiltState> {
  const profileDir = options.profileDir;
  const resumesDir = options.resumesDir ?? `${profileDir}/resumes`;
  const { signal } = options;
  const profile = await loadActiveProfile(profileDir);
  throwIfAborted(signal);
  options.onProgress?.(0);

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
  let storedJobRefinement: JobRefinement | null = null;

  if (config.jd) {
    let jobAnalysis: JobAnalysis;
    let curatorResult: CuratorResult;

    const stored =
      options.jobId != null ? await loadJobRefinement(profileDir, options.jobId) : null;
    storedJobRefinement = stored;

    if (stored) {
      jobAnalysis = stored.jobAnalysis;
      curatorResult = { plan: stored.plan, refMap: buildRefMapForProfile(profile) };
    } else {
      try {
        jobAnalysis = await analyzeJobDescription(config.jd);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw e;
        }
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
      throwIfAborted(signal);

      curatorResult = await curateForJob(profile, jobAnalysis);
      throwIfAborted(signal);

      if (options.jobId) {
        const prevRef = await loadJobRefinement(profileDir, options.jobId);
        const refinement: JobRefinement = {
          jobId: options.jobId,
          createdAt: new Date().toISOString(),
          jobAnalysis,
          plan: curatorResult.plan,
          ...(prevRef?.pinnedRender != null ? { pinnedRender: prevRef.pinnedRender } : {}),
        };
        await saveJobRefinement(refinement, profileDir);
        storedJobRefinement = refinement;
      }
    }

    throwIfAborted(signal);
    options.onProgress?.(1);

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
    throwIfAborted(signal);

    const slug = makeJobSlug(config.company, config.jobTitle);
    const jobProfile = resumeDocToJobProfile(resumeDoc, profile);
    await Promise.all([
      saveJobRefinedProfile(jobProfile, profileDir, slug),
      profileToMarkdown(jobProfile, jobRefinedMdPath(profileDir, slug)),
    ]);
    options.onProgress?.(2);
  } else {
    resumeDoc = assembleFullResumeDocument(profile, config);
    const { effectiveFlair } = getFlairInfo(config.flair, 'general');
    resumeDoc = { ...resumeDoc, flair: effectiveFlair };
    options.onProgress?.(1);
  }

  throwIfAborted(signal);

  if (options.templateOverride) {
    resumeDoc = { ...resumeDoc, template: options.templateOverride };
  }

  if (resumeDoc.template === 'timeline' && !resumeDoc.logoDataUris) {
    const cache = await loadLogoCache(profileDir);
    resumeDoc = { ...resumeDoc, logoDataUris: { ...cache } };
  }

  return {
    profile,
    resumeDocFull: resumeDoc,
    config,
    storedJobRefinement,
    resumesDir,
    profileDir,
    flair: options.flair,
    templateOverride: options.templateOverride,
    jobId: options.jobId,
  };
}

export interface RunTuiGenerateRenderPhaseOptions {
  sectionSelection: string[];
  signal?: AbortSignal;
  onProgress?: (stepIndex: number) => void;
}

/** Apply section selection, HTML squeeze loop, PDF export, save config (after `runTuiGenerateBuildPhase`). */
export async function runTuiGenerateRenderPhase(
  built: TuiGenerateBuiltState,
  ro: RunTuiGenerateRenderPhaseOptions,
): Promise<RunTuiGeneratePdfResult> {
  const { signal } = ro;
  const {
    profile,
    config: baseConfig,
    storedJobRefinement,
    resumesDir,
    profileDir,
    flair,
    templateOverride,
    jobId,
  } = built;
  const config = baseConfig;

  const appliedSections = applyResumeSectionSelection(built.resumeDocFull, ro.sectionSelection);
  let resumeDoc = appliedSections.doc;
  config.sectionSelection = ro.sectionSelection;

  const personSlug = safeName(profile.contact.name.value);
  const fileBaseName = `${personSlug}-resume`;
  const outSlug = config.company ? makeJobSlug(config.company, config.jobTitle ?? '') : null;
  const resumeOutputDir = outSlug ? `${resumesDir}/${outSlug}` : resumesDir;

  const nowTs = new Date();
  const date = nowTs.toISOString().slice(0, 10);
  const hhmm = nowTs.toTimeString().slice(0, 5).replace(':', '');
  const outputPath = `${resumeOutputDir}/${fileBaseName}_${date}-${hhmm}.pdf`;

  let squeeze = await renderWithSqueeze(resumeDoc, {
    requestedFlair: flair,
    templateOverride,
    reusePin: jobId != null ? storedJobRefinement?.pinnedRender : undefined,
  });
  let { html, appliedSqueezeLevel } = squeeze;
  throwIfAborted(signal);

  for (let step = 0; step < 6; step += 1) {
    throwIfAborted(signal);
    const fit = await measurePageFit(html);
    if (!fit.overflows) {
      break;
    }
    const trimmed = await autoTrimToFit(resumeDoc, fit.ratio);
    squeeze = await renderWithSqueeze(trimmed, {
      requestedFlair: flair,
      templateOverride,
    });
    resumeDoc = trimmed;
    html = squeeze.html;
    appliedSqueezeLevel = squeeze.appliedSqueezeLevel;
  }

  throwIfAborted(signal);
  ro.onProgress?.(config.jd ? 3 : 2);
  ro.onProgress?.(config.jd ? 4 : 3);
  await exportToPdf(html, { template: resumeDoc.template, outputPath });

  config.profileUpdatedAt = profile.updatedAt;
  config.resolvedTemplate = resumeDoc.template;
  await saveGenerationConfig(config, profileDir);

  if (jobId != null && config.jd) {
    await persistJobRefinementPinnedRender(profileDir, jobId, {
      requestedFlair: flair,
      effectiveFlair: resumeDoc.flair,
      resolvedTemplate: resumeDoc.template,
      templateOverride,
      squeezeLevel: appliedSqueezeLevel,
      updatedAt: new Date().toISOString(),
    });
  }

  ro.onProgress?.(config.jd ? 5 : 4);
  return { outputPath, config };
}

/** One-shot generate with every section included (same as build + render with all keys). */
export async function runTuiGeneratePdf(
  options: RunTuiGeneratePdfOptions,
): Promise<RunTuiGeneratePdfResult> {
  const built = await runTuiGenerateBuildPhase(options);
  const sectionSelection = collectDefaultSectionKeys(built.resumeDocFull);
  return runTuiGenerateRenderPhase(built, {
    sectionSelection,
    signal: options.signal,
    onProgress: options.onProgress,
  });
}
