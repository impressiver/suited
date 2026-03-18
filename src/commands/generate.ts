import { readFile } from 'fs/promises';
import {
  loadActiveProfile, saveGenerationConfig, loadGenerationConfig, clearGenerationConfig,
  generationConfigPath, refinedMdPath, refinedJsonPath, loadRefined, saveRefined, saveSource,
  loadJobs, saveJob, deleteJob,
  loadJobRefinement, saveJobRefinement,
  loadContactMeta, saveContactMeta,
  loadLogoCache, saveLogoCache,
} from '../profile/serializer.js';
import { markdownToProfile } from '../profile/markdown.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { analyzeJobDescription } from '../generate/job-analyzer.js';
import { curateForJob, buildRefMapForProfile } from '../generate/curator.js';
import {
  assembleResumeDocument, assembleFullResumeDocument,
  getRecommendedFlair, getFlairInfo,
} from '../generate/resume-builder.js';
import { renderResumeHtml } from '../generate/renderer.js';
import { polishResumeForJob } from '../generate/polisher.js';
import { autoTrimToFit } from '../generate/trimmer.js';
import { evaluateForJob, printJobEvaluation, applyJobFeedback, enrichFindingsWithUserInput, resumeDocContext } from '../generate/consultant.js';
import { fetchSvgsFromUrl, discoverLogoSvgs } from '../generate/logo-fetcher.js';
import { extractLogomark, svgToDataUri } from '../generate/logo-extractor.js';
import { buildFitOverrideCss, SQUEEZE_THRESHOLDS, SQUEEZE_GIVES_UP_AT, type SqueezeLevel } from '../generate/fit-adjuster.js';
import { exportToPdf, measurePageFit } from '../pdf/exporter.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import type { FlairLevel, IndustryVertical, GenerationConfig, SavedJob, Profile, ResumeDocument, JobRefinement } from '../profile/schema.js';
import { c } from '../utils/colors.js';

export interface GenerateOptions {
  profileDir?: string;
  output?: string;
  jd?: string;
  flair?: string;
}

const INDUSTRY_LABELS: Record<IndustryVertical, string> = {
  'software-engineering': 'Software Engineering',
  'finance': 'Finance',
  'design': 'Design',
  'marketing': 'Marketing',
  'consulting': 'Consulting',
  'academia': 'Academia',
  'healthcare': 'Healthcare',
  'legal': 'Legal',
  'general': 'General',
  'ai': 'AI / Machine Learning',
};

// ---------------------------------------------------------------------------
// Contact details guard
// ---------------------------------------------------------------------------

async function ensureContactDetails(
  profile: Profile,
  profileDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
): Promise<Profile> {
  const missing: string[] = [];
  if (!profile.contact.headline) missing.push('job title');
  if (!profile.contact.email)    missing.push('email');
  if (!profile.contact.phone)    missing.push('phone');
  if (!profile.contact.linkedin) missing.push('LinkedIn URL');
  if (missing.length === 0) return profile;

  console.log(`\n${c.warn} ${c.warning(`Missing contact info: ${missing.join(', ')}`)}`);

  const now = new Date().toISOString();
  const userEdit = (v: string) => ({ value: v, source: { kind: 'user-edit' as const, editedAt: now } });
  const updates: Partial<Profile['contact']> = {};

  if (!profile.contact.headline) {
    const { headline } = await inquirer.prompt([
      { type: 'input', name: 'headline', message: 'Current job title / headline (leave blank to skip):' },
    ]) as { headline: string };
    if (headline.trim()) updates.headline = userEdit(headline.trim());
  }

  if (!profile.contact.email) {
    const { email } = await inquirer.prompt([
      { type: 'input', name: 'email', message: 'Email address (leave blank to skip):' },
    ]) as { email: string };
    if (email.trim()) updates.email = userEdit(email.trim());
  }

  if (!profile.contact.phone) {
    const { phone } = await inquirer.prompt([
      { type: 'input', name: 'phone', message: 'Phone number (leave blank to skip):' },
    ]) as { phone: string };
    if (phone.trim()) updates.phone = userEdit(phone.trim());
  }

  if (!profile.contact.linkedin) {
    const { linkedin } = await inquirer.prompt([
      { type: 'input', name: 'linkedin', message: 'LinkedIn URL (leave blank to skip):' },
    ]) as { linkedin: string };
    if (linkedin.trim()) updates.linkedin = userEdit(linkedin.trim());
  }

  if (Object.keys(updates).length === 0) return profile;

  const updated: Profile = { ...profile, contact: { ...profile.contact, ...updates } };

  // Persist to whichever profile is active
  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile: updated }, profileDir);
  } else {
    await saveSource(updated, profileDir);
  }

  // Also persist to contact.json so these details survive future re-imports
  const existing = await loadContactMeta(profileDir);
  await saveContactMeta({
    ...existing,
    ...(updates.headline ? { headline: updates.headline.value } : {}),
    ...(updates.email    ? { email:    updates.email.value    } : {}),
    ...(updates.phone    ? { phone:    updates.phone.value    } : {}),
    ...(updates.linkedin ? { linkedin: updates.linkedin.value } : {}),
    ...(updates.location ? { location: updates.location.value } : {}),
  }, profileDir);

  console.log(`  ${c.ok} ${c.success('Contact details saved.')}`);

  return updated;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  const profileDir = options.profileDir ?? 'output';
  const resumesDir = options.output ?? `${profileDir}/resumes`;

  // Load the best available profile (refined → source)
  let profile = await loadActiveProfile(profileDir);
  const usingRefined = await fileExists(refinedJsonPath(profileDir));

  console.log(`${c.ok} Loaded ${c.muted(usingRefined ? 'refined' : 'source')} profile: ${c.value(profile.contact.name.value)}`);
  console.log(c.muted(`  ${profile.positions.length} positions · ${profile.skills.length} skills · ${profile.education.length} education entries`));
  if (!usingRefined) {
    console.log(c.tip("  Tip: run 'resume refine' first to improve your profile with Claude's help."));
  }

  profile = await ensureContactDetails(profile, profileDir, inquirer);

  // Check for saved generation config — discard it if the profile has changed
  const savedConfig = await loadGenerationConfig(profileDir);
  let reuseConfig = false;

  if (savedConfig) {
    const profileChanged =
      savedConfig.profileUpdatedAt !== undefined &&
      savedConfig.profileUpdatedAt !== profile.updatedAt;

    if (profileChanged) {
      console.log(`\n${c.warn} ${c.warning('Profile data has changed — previous generation settings have been discarded.')}`);
      await clearGenerationConfig(profileDir);
    } else {
      const configDate = new Date(savedConfig.updatedAt).toLocaleDateString();
      const target = savedConfig.company
        ? `${savedConfig.company} — ${savedConfig.jobTitle}`
        : savedConfig.jobTitle || 'general resume';
      console.log(`\n${c.muted('Previous generation:')} ${c.value(target)} ${c.muted(`(${configDate}, flair ${savedConfig.flair})`)}`);

      const { reuse } = await inquirer.prompt([
        { type: 'confirm', name: 'reuse', message: 'Use the same settings?', default: true },
      ]) as { reuse: boolean };
      reuseConfig = reuse;
    }
  }

  let continueLoop = true;

  while (continueLoop) {
    let config: GenerationConfig;

    if (reuseConfig && savedConfig) {
      config = { ...savedConfig };
    } else {
      config = await buildConfig(options, inquirer, profileDir, profile);
    }

    // Curate if JD provided; otherwise include everything
    const templateOverride = config.templateOverride;
    let resumeDoc;
    if (config.jd) {
      // Analyze JD (may already be in saved config)
      if (!config.jobAnalysis) {
        console.log(c.muted('\nAnalyzing job description...'));
        config.jobAnalysis = await analyzeJobDescription(config.jd);
        // Auto-save this JD and capture the job ID
        const savedId = await autoSaveJob(config.jd, config.jobAnalysis.company, config.jobAnalysis.title, profileDir);
        if (!config.jobId) config.jobId = savedId;
      }

      const { jobAnalysis } = config;
      console.log('\nJob Analysis:');
      console.log(`  ${c.label('Company:')}    ${jobAnalysis.company}`);
      console.log(`  ${c.label('Title:')}      ${jobAnalysis.title}`);
      console.log(`  ${c.label('Industry:')}   ${INDUSTRY_LABELS[jobAnalysis.industry]}`);
      console.log(`  ${c.label('Seniority:')}  ${jobAnalysis.seniority}`);
      console.log(`  ${c.label('Key Skills:')} ${jobAnalysis.keySkills.slice(0, 6).join(', ')}`);

      if (!reuseConfig) {
        const { ok } = await inquirer.prompt([
          { type: 'confirm', name: 'ok', message: 'Does this analysis look correct?', default: true },
        ]) as { ok: boolean };

        if (!ok) {
          const overrides = await inquirer.prompt([
            { type: 'input', name: 'company', message: 'Company name:', default: jobAnalysis.company },
            { type: 'input', name: 'title', message: 'Job title:', default: jobAnalysis.title },
            {
              type: 'list', name: 'industry', message: 'Industry:',
              choices: Object.entries(INDUSTRY_LABELS).map(([v, n]) => ({ value: v, name: n })),
              default: jobAnalysis.industry,
            },
          ]) as Partial<typeof jobAnalysis>;
          config.jobAnalysis = { ...jobAnalysis, ...overrides };
        }
      }
      // Always sync company/jobTitle from the (possibly overridden) analysis
      config.company = config.jobAnalysis.company;
      config.jobTitle = config.jobAnalysis.title;

      const { effectiveFlair, effectiveTemplate, warning } = getFlairInfo(
        config.flair, config.jobAnalysis.industry,
      );
      if (warning) {
        console.log(`\n${c.warn} ${c.warning(warning)}`);
        const { proceed } = await inquirer.prompt([
          { type: 'confirm', name: 'proceed', message: `Proceed with classic template (flair ${effectiveFlair})?`, default: true },
        ]) as { proceed: boolean };
        if (!proceed) { reuseConfig = false; continue; }
      }
      console.log(`  ${c.label('Template:')} ${effectiveTemplate} ${c.muted(`(flair ${effectiveFlair})`)}`);

      // Check for stored job refinement (skip Claude curation if available)
      let curatorResult: import('../generate/curator.js').CuratorResult | undefined;
      let usedStoredRefinement = false;

      if (config.jobId) {
        const stored = await loadJobRefinement(profileDir, config.jobId);
        if (stored) {
          console.log(c.muted(`\nUsing stored job refinement from ${new Date(stored.createdAt).toLocaleDateString()}...`));
          curatorResult = { plan: stored.plan, refMap: buildRefMapForProfile(profile) };
          usedStoredRefinement = true;
        }
      }

      if (!curatorResult) {
        console.log(c.muted('\nCurating resume with Claude...'));
        try {
          curatorResult = await curateForJob(profile, config.jobAnalysis);
        } catch (err) {
          console.error(`\n${c.fail} ${c.error(`Curation failed: ${(err as Error).message}`)}`);
          const { retry } = await inquirer.prompt([
            { type: 'confirm', name: 'retry', message: 'Retry curation?', default: true },
          ]) as { retry: boolean };
          if (retry) { reuseConfig = false; continue; }
          break;
        }
        // Save this refinement for future reuse
        if (config.jobId) {
          const refinement: JobRefinement = {
            jobId: config.jobId,
            createdAt: new Date().toISOString(),
            jobAnalysis: config.jobAnalysis,
            plan: curatorResult.plan,
          };
          await saveJobRefinement(refinement, profileDir);
        }
      }

      const { plan } = curatorResult;
      console.log('\nCuration Summary:');
      if (usedStoredRefinement) console.log(c.muted('  (from stored refinement)'));
      console.log(`  ${c.label('Positions:')} ${plan.selectedPositions.length}`);
      for (const selPos of plan.selectedPositions) {
        const pos = profile.positions.find(p => p.id === selPos.positionId);
        console.log(`    ${c.muted('•')} ${pos?.title.value} ${c.muted(`@ ${pos?.company.value} (${selPos.bulletRefs.length} bullets)`)}`);
      }
      console.log(`  ${c.label('Skills:')}    ${plan.selectedSkillIds.length}`);
      console.log(`  ${c.label('Education:')} ${plan.selectedEducationIds.length}`);

      console.log(`\n${c.ok} ${c.success('Accuracy check passed')}`);
      resumeDoc = assembleResumeDocument(
        profile, plan, curatorResult.refMap,
        effectiveFlair, config.jobAnalysis.industry,
        config.jobTitle, config.company,
      );

      // Auto-polish bullets to fit the job — no user interaction, no facts added
      console.log(c.muted(`Polishing bullets for ${config.jobAnalysis.title} at ${config.jobAnalysis.company}...`));
      try {
        resumeDoc = await polishResumeForJob(resumeDoc, config.jobAnalysis);
      } catch (err) {
        console.log(c.muted(`  Polish skipped (${(err as Error).message})`));
      }

      // Hiring consultant evaluation — show before the final confirm so user can iterate
      console.log(c.muted('\nRunning job fit review...'));
      try {
        const jobEval = await evaluateForJob(resumeDoc, config.jobAnalysis);
        printJobEvaluation(jobEval);

        if (jobEval.gaps.length > 0) {
          const { feedbackAction } = await inquirer.prompt([{
            type: 'list',
            name: 'feedbackAction',
            message: 'Incorporate consultant feedback?',
            choices: [
              { value: 'skip', name: 'Skip' },
              { value: 'all',  name: 'Apply all suggestions' },
              { value: 'pick', name: 'Choose which suggestions to apply' },
            ],
          }]) as { feedbackAction: string };

          if (feedbackAction !== 'skip') {
            let selectedGaps = jobEval.gaps;
            if (feedbackAction === 'pick') {
              const { chosen } = await inquirer.prompt([{
                type: 'checkbox',
                name: 'chosen',
                message: 'Select suggestions to apply:',
                choices: jobEval.gaps.map((gap, i) => ({
                  name: `${gap.area}: ${gap.issue}`,
                  value: i,
                  checked: true,
                })),
              }]) as { chosen: number[] };
              selectedGaps = chosen.map(i => jobEval.gaps[i]);
            }

            if (selectedGaps.length > 0) {
              // Ask Claude what facts are needed, then prompt user for answers
              selectedGaps = await enrichFindingsWithUserInput(selectedGaps, inquirer, resumeDocContext(resumeDoc));

              console.log(c.muted('\nApplying consultant feedback...'));
              try {
                resumeDoc = await applyJobFeedback(resumeDoc, config.jobAnalysis, selectedGaps);
              } catch (err) {
                console.log(c.muted(`  Failed to apply feedback: ${(err as Error).message}`));
              }
            }
          }
        }
      } catch (err) {
        console.log(c.muted(`  Job fit review unavailable: ${(err as Error).message}`));
      }
    } else {
      // No JD — include everything
      const { effectiveFlair, effectiveTemplate } = getFlairInfo(config.flair, 'general');
      const displayTemplate = templateOverride ?? effectiveTemplate;
      console.log(`\n  ${c.label('Template:')} ${displayTemplate}${templateOverride ? '' : c.muted(` (flair ${effectiveFlair})`)}`);
      resumeDoc = assembleFullResumeDocument(profile, config);
    }

    // Apply template override (e.g. 'retro') regardless of flair-based selection
    if (templateOverride) resumeDoc = { ...resumeDoc, template: templateOverride };

    // For timeline: interactively collect logos (ask user for URLs on low-confidence results)
    if (resumeDoc.template === 'timeline' && !resumeDoc.logoDataUris) {
      resumeDoc = { ...resumeDoc, logoDataUris: await collectTimelineLogos(resumeDoc, inquirer, profileDir) };
    }

    // Section / experience selection always shown before the final generate confirm
    resumeDoc = await selectSections(resumeDoc, inquirer);

    // For JD-targeted resumes, confirm generation after sections are chosen.
    // "Generate PDF" is now the last interactive step before file I/O.
    if (config.jd) {
      const { action } = await inquirer.prompt([
        {
          type: 'list', name: 'action', message: 'What would you like to do?',
          choices: [
            { value: 'generate', name: '✓ Generate PDF' },
            { value: 'edit',     name: '✎ Edit refined data and re-curate' },
            { value: 'retry',    name: '↻ Re-run curation (refresh stored refinement)' },
            { value: 'cancel',   name: '✗ Cancel' },
          ],
        },
      ]) as { action: string };

      if (action === 'cancel') break;
      if (action === 'retry') { reuseConfig = false; continue; }
      if (action === 'edit') {
        await editRefinedProfile(profileDir);
        reuseConfig = false;
        continue;
      }
      // 'generate' falls through to file generation below
    }

    const safeName = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nowTs = new Date();
    const date = nowTs.toISOString().slice(0, 10);
    const hhmm = nowTs.toTimeString().slice(0, 5).replace(':', '');
    const namePart = config.company
      ? `${safeName(config.company)}-${safeName(config.jobTitle)}`
      : safeName(config.jobTitle) || 'resume';

    if (config.allTemplates) {
      // Generate one PDF per template
      console.log(c.muted('\nGenerating all templates...'));
      const generatedPaths = await generateAllTemplates(resumeDoc, namePart, resumesDir, inquirer, profileDir);
      config.profileUpdatedAt = profile.updatedAt;
      await saveGenerationConfig(config, profileDir);
      console.log(`\n${c.ok} ${c.success(`Generated ${generatedPaths.length} resume(s).`)}`);
      console.log(c.muted(`  Settings saved to ${generationConfigPath(profileDir)}`));
    } else {
      // Single template
      const outputPath = `${resumesDir}/${namePart}-${date}-${hhmm}.pdf`;

      // Render → squeeze CSS → content trim → export
      console.log(c.muted('Rendering HTML...'));
      let html = await renderResumeHtml(resumeDoc);

      let fitCancelled = false;
      console.log(c.muted('Checking page fit...'));

      // Phase 1: try progressive CSS adjustments before touching content
      html = await trySqueeze(html, resumeDoc);

      // Phase 2: if still overflowing after max CSS squeeze, ask the user
      while (true) { // eslint-disable-line no-constant-condition
        const fit = await measurePageFit(html);
        if (!fit.overflows) break;

        const pct = Math.round(fit.ratio * 100);
        console.log(`\n${c.warn} ${c.warning(`Still ~${pct}% of page height after layout adjustments.`)}`);
        const { fitAction } = await inquirer.prompt([
          {
            type: 'list', name: 'fitAction',
            message: 'Content still exceeds one page. What would you like to do?',
            choices: [
              { value: 'auto',   name: 'Auto-trim to fit (AI picks what to cut)' },
              { value: 'trim',   name: 'Remove sections or entries manually' },
              { value: 'anyway', name: 'Generate anyway — content will be clipped at page edge' },
              { value: 'cancel', name: 'Cancel' },
            ],
          },
        ]) as { fitAction: string };

        if (fitAction === 'cancel') { fitCancelled = true; break; }
        if (fitAction === 'anyway') break;
        if (fitAction === 'auto') {
          console.log(c.muted('  Asking AI to trim content to fit...'));
          try {
            resumeDoc = await autoTrimToFit(resumeDoc, fit.ratio);
          } catch (err) {
            console.log(c.muted(`  Auto-trim failed (${(err as Error).message}) — falling back to manual.`));
            resumeDoc = await selectSections(resumeDoc, inquirer);
          }
        } else {
          resumeDoc = await selectSections(resumeDoc, inquirer);
        }
        html = await renderResumeHtml(resumeDoc);
        html = await trySqueeze(html, resumeDoc);
      }
      if (fitCancelled) break;

      console.log(c.muted('Generating PDF...'));
      await exportToPdf(html, { template: resumeDoc.template, outputPath });

      // Save config so this run is repeatable; stamp profile version for stale-check
      config.profileUpdatedAt = profile.updatedAt;
      await saveGenerationConfig(config, profileDir);
      console.log(`\n${c.ok} ${c.success('Resume generated:')} ${c.path(outputPath)}`);
      console.log(c.muted(`  Settings saved to ${generationConfigPath(profileDir)}`));
    };

    const { next } = await inquirer.prompt([
      {
        type: 'list', name: 'next', message: 'What next?',
        choices: [
          { value: 'done', name: 'Done' },
          { value: 'flair', name: 'Try a different flair level' },
          { value: 'newjd', name: 'Generate for a different job' },
          { value: 'edit', name: 'Edit refined data and regenerate' },
        ],
      },
    ]) as { next: string };

    if (next === 'done') {
      continueLoop = false;
    } else if (next === 'flair') {
      reuseConfig = false;
      options.flair = undefined;
      config.jd = config.jd; // keep JD
    } else if (next === 'newjd') {
      reuseConfig = false;
      options.jd = undefined;
      options.flair = undefined;
    } else if (next === 'edit') {
      await editRefinedProfile(profileDir);
      reuseConfig = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Build a new GenerationConfig interactively
// ---------------------------------------------------------------------------

async function buildConfig(
  options: GenerateOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
  profileDir: string,
  profile?: Profile,
): Promise<GenerationConfig> {
  // JD — optional
  let jdText = options.jd;
  let selectedJobId: string | undefined;

  if (jdText === undefined) {
    const savedJobs = await loadJobs(profileDir);

    const choices = [
      ...(savedJobs.length > 0
        ? [{ name: `Saved job descriptions  ${c.muted(`(${savedJobs.length} saved)`)}`, value: 'saved' }]
        : []),
      { name: 'Paste / type text', value: 'paste' },
      { name: 'File path', value: 'file' },
      { name: 'Skip — generate full resume (no job targeting)', value: 'skip' },
    ];

    const { jdSource } = await inquirer.prompt([
      { type: 'list', name: 'jdSource', message: 'Job description:', choices },
    ]) as { jdSource: string };

    if (jdSource === 'saved') {
      const result = await pickSavedJob(inquirer, savedJobs, profileDir);
      if (result) {
        jdText = result.text;
        selectedJobId = result.id;
      }
    } else if (jdSource === 'paste') {
      const { jd } = await inquirer.prompt([
        { type: 'editor', name: 'jd', message: 'Paste the job description (save and close editor):' },
      ]) as { jd: string };
      jdText = jd;
    } else if (jdSource === 'file') {
      const { filePath } = await inquirer.prompt([
        { type: 'input', name: 'filePath', message: 'Path to job description file:' },
      ]) as { filePath: string };
      jdText = await readFile(filePath, 'utf-8');
    }
    // 'skip' → jdText remains undefined
  }

  // Company / title (for filename + header when no JD)
  let company = '';
  let jobTitle = 'Resume';
  if (!jdText) {
    const headlineDefault = profile?.contact.headline?.value ?? 'Resume';
    const answers = await inquirer.prompt([
      { type: 'input', name: 'company', message: 'Target company (optional, for filename):' },
      { type: 'input', name: 'jobTitle', message: 'Target role / title (optional):', default: headlineDefault },
    ]) as { company: string; jobTitle: string };
    company = answers.company;
    jobTitle = answers.jobTitle;
  }

  // Flair
  let flair: FlairLevel = options.flair
    ? (parseInt(options.flair, 10) as FlairLevel)
    : 3;

  let templateOverride: import('../profile/schema.js').TemplateName | undefined;

  if (!options.flair) {
    const { selectedFlair } = await inquirer.prompt([
      {
        type: 'list', name: 'selectedFlair',
        message: 'Select flair level:',
        choices: [
          { value: 1, name: '1 — Classic (ATS-safe, serif, no color)' },
          { value: 2, name: '2 — Classic+ (clean, minimal accents)' },
          { value: 3, name: '3 — Modern (accent color, sans-serif)' },
          { value: 4, name: '4 — Modern+ (bolder accents, pill skills)' },
          { value: 5, name: '5 — Bold (full sidebar, color block)' },
          { value: 'retro',    name: '★ — Retro Terminal (amber-on-black, ASCII art)' },
          { value: 'timeline', name: '◈ — Timeline (dark header, prose entries, two-column)' },
          { value: 'all',      name: '⊞ — All templates (generate one PDF per template)' },
        ],
        default: getRecommendedFlair('general'),
      },
    ]) as { selectedFlair: FlairLevel | 'retro' | 'timeline' | 'all' };

    if (selectedFlair === 'retro') {
      templateOverride = 'retro';
      flair = 1;
    } else if (selectedFlair === 'timeline') {
      templateOverride = 'timeline';
      flair = 4;
    } else if (selectedFlair === 'all') {
      flair = 1;
      templateOverride = undefined;
      return {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        flair,
        template: 'classic',
        templateOverride,
        allTemplates: true,
        jobTitle,
        company,
        jd: jdText,
        jobId: selectedJobId,
      };
    } else {
      flair = selectedFlair;
    }
  }

  return {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    flair,
    template: 'classic', // will be overridden by getFlairInfo or templateOverride at render time
    templateOverride,
    jobTitle,
    company,
    jd: jdText,
    jobId: selectedJobId,
  };
}

// ---------------------------------------------------------------------------
// Saved job helpers
// ---------------------------------------------------------------------------

async function autoSaveJob(
  text: string,
  company: string,
  title: string,
  profileDir: string,
): Promise<string> {
  const { createHash } = await import('crypto');
  const textHash = createHash('sha256').update(text).digest('hex');
  // If already saved, return the existing job's ID
  const existing = await loadJobs(profileDir);
  const dup = existing.find(j => j.textHash === textHash);
  if (dup) return dup.id;
  const job: SavedJob = {
    id: `job-${Date.now()}`,
    company,
    title,
    savedAt: new Date().toISOString(),
    text,
    textHash,
  };
  await saveJob(job, profileDir);
  return job.id;
}

async function pickSavedJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
  jobs: SavedJob[],
  profileDir: string,
): Promise<{ text: string; id: string } | undefined> {
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Choose a saved job description:',
      choices: [
        ...jobs.map(j => ({
          name: `${j.company} — ${j.title}  ${c.muted(new Date(j.savedAt).toLocaleDateString())}`,
          value: j.id,
        })),
        { name: c.muted('Delete a saved JD…'), value: '__delete__' },
        { name: c.muted('← Back'), value: '__back__' },
      ],
    },
  ]) as { choice: string };

  if (choice === '__back__') return undefined;

  if (choice === '__delete__') {
    const { toDelete } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'toDelete',
        message: 'Select JDs to delete:',
        choices: jobs.map(j => ({
          name: `${j.company} — ${j.title}  ${c.muted(new Date(j.savedAt).toLocaleDateString())}`,
          value: j.id,
        })),
      },
    ]) as { toDelete: string[] };
    for (const id of toDelete) await deleteJob(id, profileDir);
    console.log(c.muted(`  Deleted ${toDelete.length} saved JD(s).`));
    // Re-show the picker with the updated list
    const updated = await loadJobs(profileDir);
    if (updated.length === 0) return undefined;
    return pickSavedJob(inquirer, updated, profileDir);
  }

  const job = jobs.find(j => j.id === choice);
  if (!job) return undefined;
  return { text: job.text, id: job.id };
}

// ---------------------------------------------------------------------------
// Unified section + experience selector (always shown before generating)
// ---------------------------------------------------------------------------

async function selectSections(
  doc: ResumeDocument,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
): Promise<ResumeDocument> {
  // Build a merged list: individual position items + other sections
  type Choice = { name: string; value: string; checked: boolean };
  const choices: Choice[] = [
    ...(doc.summary
      ? [{ name: 'Summary', value: 'summary', checked: true }]
      : []),
    // Individual position entries replace a single "Experience" item
    ...doc.positions.map((p, i) => ({
      name: `${p.title} @ ${p.company}  ${c.muted(`${p.startDate} – ${p.endDate ?? 'Present'} · ${p.bullets.length} bullet${p.bullets.length === 1 ? '' : 's'}`)}`,
      value: `pos:${i}`,
      checked: true,
    })),
    ...(doc.education.length      ? [{ name: `Education  (${doc.education.length})`,           value: 'education',      checked: true }] : []),
    ...(doc.skills.length         ? [{ name: `Skills  (${doc.skills.length})`,                  value: 'skills',         checked: true }] : []),
    ...(doc.projects.length       ? [{ name: `Projects  (${doc.projects.length})`,              value: 'projects',       checked: true }] : []),
    ...(doc.certifications.length ? [{ name: `Certifications  (${doc.certifications.length})`, value: 'certifications', checked: true }] : []),
    ...(doc.languages.length      ? [{ name: `Languages  (${doc.languages.length})`,            value: 'languages',      checked: true }] : []),
    ...(doc.volunteer.length      ? [{ name: `Volunteer  (${doc.volunteer.length})`,            value: 'volunteer',      checked: true }] : []),
    ...(doc.awards.length         ? [{ name: `Awards  (${doc.awards.length})`,                  value: 'awards',         checked: true }] : []),
  ];

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select sections and experience entries to include:',
      choices,
    },
  ]) as { selected: string[] };

  const enabled = new Set(selected);

  // Derive selected position indices from pos:N values
  const selectedPosIdxs = selected
    .filter(v => v.startsWith('pos:'))
    .map(v => parseInt(v.slice(4), 10))
    .sort((a, b) => a - b);

  // Gap-fill: positions are newest-first; include every entry between selected extremes
  let selectedPositions: ResumeDocument['positions'] = [];
  if (selectedPosIdxs.length > 0) {
    const maxIdx = Math.max(...selectedPosIdxs);
    const selectedSet = new Set(selectedPosIdxs);
    const autoFilled: string[] = [];
    for (let i = 0; i <= maxIdx; i++) {
      if (!selectedSet.has(i)) autoFilled.push(doc.positions[i]?.company ?? '');
    }
    if (autoFilled.length > 0) {
      console.log(`  ${c.warn} ${c.warning(`Re-included to avoid employment gaps: ${autoFilled.join(', ')}`)}`);
    }
    for (let i = 0; i <= maxIdx; i++) {
      selectedPositions.push(doc.positions[i]);
    }
  }

  return {
    ...doc,
    summary:        enabled.has('summary')        ? doc.summary        : undefined,
    positions:      selectedPositions,
    education:      enabled.has('education')       ? doc.education      : [],
    skills:         enabled.has('skills')          ? doc.skills         : [],
    projects:       enabled.has('projects')        ? doc.projects       : [],
    certifications: enabled.has('certifications')  ? doc.certifications : [],
    languages:      enabled.has('languages')       ? doc.languages      : [],
    volunteer:      enabled.has('volunteer')       ? doc.volunteer      : [],
    awards:         enabled.has('awards')          ? doc.awards         : [],
  };
}

// ---------------------------------------------------------------------------
// Generate all templates at once
// ---------------------------------------------------------------------------

const ALL_TEMPLATE_CONFIGS: Array<{ template: import('../profile/schema.js').TemplateName; flair: FlairLevel; label: string }> = [
  { template: 'classic',  flair: 2, label: 'classic'  },
  { template: 'modern',   flair: 3, label: 'modern'   },
  { template: 'bold',     flair: 5, label: 'bold'     },
  { template: 'timeline', flair: 4, label: 'timeline' },
  { template: 'retro',    flair: 1, label: 'retro'    },
];

async function generateAllTemplates(
  baseDoc: ResumeDocument,
  namePart: string,
  resumesDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
  profileDir: string,
): Promise<string[]> {
  const paths: string[] = [];
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hhmm = now.toTimeString().slice(0, 5).replace(':', '');

  // Content trimmed by the user carries over to all subsequent templates
  let currentBase = baseDoc;

  for (const tc of ALL_TEMPLATE_CONFIGS) {
    let doc: ResumeDocument = { ...currentBase, template: tc.template, flair: tc.flair };
    // Fetch logos interactively for timeline if not already done
    if (tc.template === 'timeline' && !doc.logoDataUris) {
      doc = { ...doc, logoDataUris: await collectTimelineLogos(doc, inquirer, profileDir) };
      currentBase = { ...currentBase, logoDataUris: doc.logoDataUris };
    }
    console.log(c.muted(`  Rendering ${tc.label}...`));
    let html = await renderResumeHtml(doc);

    // Phase 1: try CSS squeeze before content removal
    html = await trySqueeze(html, doc);

    // Phase 2: if still overflowing, ask user
    let skip = false;
    while (true) { // eslint-disable-line no-constant-condition
      const fit = await measurePageFit(html);
      if (!fit.overflows) break;

      const { fitAction } = await inquirer.prompt([
        {
          type: 'list', name: 'fitAction',
          message: `  [${tc.label}] Still ~${Math.round(fit.ratio * 100)}% after layout adjustments. What to do?`,
          choices: [
            { value: 'auto',   name: 'Auto-trim to fit (AI picks what to cut)' },
            { value: 'trim',   name: 'Remove sections or entries manually' },
            { value: 'anyway', name: 'Generate anyway (clipped)' },
            { value: 'skip',   name: 'Skip this template' },
          ],
        },
      ]) as { fitAction: string };

      if (fitAction === 'skip')   { skip = true; break; }
      if (fitAction === 'anyway') { break; }
      if (fitAction === 'auto') {
        console.log(c.muted(`  Asking AI to trim ${tc.label} to fit...`));
        try {
          currentBase = await autoTrimToFit(currentBase, fit.ratio);
        } catch (err) {
          console.log(c.muted(`  Auto-trim failed (${(err as Error).message}) — falling back to manual.`));
          currentBase = await selectSections(currentBase, inquirer);
        }
      } else {
        currentBase = await selectSections(currentBase, inquirer);
      }
      doc = { ...currentBase, template: tc.template, flair: tc.flair };
      html = await renderResumeHtml(doc);
      html = await trySqueeze(html, doc);
    }

    if (skip) {
      console.log(c.muted(`    Skipped ${tc.label}.`));
      continue;
    }

    const outputPath = `${resumesDir}/${namePart}-${tc.label}-${date}-${hhmm}.pdf`;
    await exportToPdf(html, { template: doc.template, outputPath });
    console.log(`  ${c.ok} ${c.path(outputPath)}`);
    paths.push(outputPath);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// CSS squeeze — try progressive layout tightening before content removal
// ---------------------------------------------------------------------------

async function trySqueeze(html: string, doc: ResumeDocument): Promise<string> {
  const initial = await measurePageFit(html);
  if (!initial.overflows) return html;

  const levels: SqueezeLevel[] = [1, 2, 3];
  let best = html;

  for (const level of levels) {
    if (initial.ratio < SQUEEZE_THRESHOLDS[level]) continue;

    const squeezed = await renderResumeHtml(doc, buildFitOverrideCss(level));
    const fit = await measurePageFit(squeezed);

    if (!fit.overflows) {
      const pct = Math.round(initial.ratio * 100);
      console.log(c.muted(`  Fits after layout adjustments (was ${pct}%, squeeze level ${level})`));
      return squeezed;
    }
    best = squeezed; // keep the tightest version as the base for user prompts
  }

  // Still overflowing after max squeeze — return the maximally-squeezed HTML
  // so at least the remaining overflow is minimised before the user decides
  const finalFit = await measurePageFit(best);
  if (finalFit.ratio < initial.ratio) {
    console.log(c.muted(`  Applied max layout adjustments (${Math.round(initial.ratio * 100)}% → ${Math.round(finalFit.ratio * 100)}%)`));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Timeline logo collection — interactive, runs once before first render
// ---------------------------------------------------------------------------

async function collectTimelineLogos(
  doc: ResumeDocument,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
  profileDir: string,
): Promise<Record<string, string>> {
  const names = [
    ...doc.positions.map(p => p.company),
    ...doc.education.map(e => e.institution),
  ];
  const unique = [...new Set(names)];

  // Load persisted cache — skip fetching for already-resolved names
  const cache = await loadLogoCache(profileDir);
  const logoUris: Record<string, string> = { ...cache };
  const toFetch = unique.filter(n => !cache[n]);

  if (toFetch.length === 0) {
    console.log(c.muted('\nUsing cached logomarks for all companies.'));
    return logoUris;
  }

  console.log(c.muted('\nFetching company logomarks...'));

  const needsUrl: string[] = [];

  // Phase 1: auto-discover SVGs from guessed domain and extract logomark
  await Promise.all(toFetch.map(async name => {
    const svgs = await discoverLogoSvgs(name);
    for (const svg of svgs) {
      const logomark = await extractLogomark(svg);
      if (logomark) {
        logoUris[name] = svgToDataUri(logomark);
        return;
      }
    }
    needsUrl.push(name);
  }));

  if (needsUrl.length === 0) {
    console.log(c.muted(`  Found logomarks for all ${unique.length} companies.`));
    await saveLogoCache(logoUris, profileDir);
    return logoUris;
  }

  // Phase 2: ask user for each company where we couldn't auto-find a logomark
  console.log(`\n${c.warn} ${c.warning(`Couldn't find logomarks for: ${needsUrl.join(', ')}`)}`);
  console.log(c.muted('  Provide a URL to an SVG file or brand/press page. Enter to skip.'));

  for (const name of needsUrl) {
    let found = false;
    while (!found) {
      const { url } = await inquirer.prompt([{
        type: 'input',
        name: 'url',
        message: `  Logo URL for "${name}":`,
      }]) as { url: string };

      if (!url.trim()) {
        console.log(c.muted(`    Using initial badge for ${name}.`));
        break;
      }

      console.log(c.muted('    Fetching and extracting logomark...'));
      const svgs = await fetchSvgsFromUrl(url.trim());

      for (const svg of svgs) {
        const logomark = await extractLogomark(svg);
        if (logomark) {
          logoUris[name] = svgToDataUri(logomark);
          console.log(c.muted(`    ✓ Logomark extracted for ${name}.`));
          found = true;
          break;
        }
      }

      if (!found) {
        if (svgs.length === 0) {
          console.log(c.warn + ' ' + c.warning('No SVG found at that URL.'));
        } else {
          console.log(c.warn + ' ' + c.warning(`Found ${svgs.length} SVG(s) but none contained a usable logomark (wordmark or unrecognised).`));
        }
        const { retry } = await inquirer.prompt([{
          type: 'confirm', name: 'retry',
          message: '    Try a different URL?',
          default: true,
        }]) as { retry: boolean };
        if (!retry) {
          console.log(c.muted(`    Using initial badge for ${name}.`));
          break;
        }
      }
    }
  }

  await saveLogoCache(logoUris, profileDir);
  return logoUris;
}

// ---------------------------------------------------------------------------
// Edit refined profile in $EDITOR and reload
// ---------------------------------------------------------------------------

async function editRefinedProfile(profileDir: string): Promise<void> {
  const refinedMd = refinedMdPath(profileDir);
  if (!(await fileExists(refinedMd))) {
    console.log('  No refined.md found — nothing to edit.');
    return;
  }
  await openInEditor(refinedMd);
  const existing = await loadRefined(profileDir);
  const updatedProfile = await markdownToProfile(refinedMd, existing.profile);
  await saveRefined({ profile: updatedProfile, session: existing.session }, profileDir);
  await profileToMarkdown(updatedProfile, refinedMd);
  console.log('Refined data reloaded from markdown.');
}
