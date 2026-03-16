import { readFile } from 'fs/promises';
import {
  loadActiveProfile, saveGenerationConfig, loadGenerationConfig, clearGenerationConfig,
  generationConfigPath, refinedMdPath, refinedJsonPath, loadRefined, saveRefined, saveSource,
  loadJobs, saveJob, deleteJob,
} from '../profile/serializer.js';
import { markdownToProfile } from '../profile/markdown.js';
import { profileToMarkdown } from '../profile/markdown.js';
import { analyzeJobDescription } from '../generate/job-analyzer.js';
import { curateForJob } from '../generate/curator.js';
import {
  assembleResumeDocument, assembleFullResumeDocument,
  getRecommendedFlair, getFlairInfo,
} from '../generate/resume-builder.js';
import { renderResumeHtml } from '../generate/renderer.js';
import { exportToPdf, measurePageFit } from '../pdf/exporter.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import type { FlairLevel, IndustryVertical, GenerationConfig, SavedJob, Profile } from '../profile/schema.js';
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
  if (!profile.contact.email) missing.push('email');
  if (!profile.contact.phone) missing.push('phone');
  if (missing.length === 0) return profile;

  console.log(`\n${c.warn} ${c.warning(`Missing contact info: ${missing.join(', ')}`)}`);

  const now = new Date().toISOString();
  const userEdit = (v: string) => ({ value: v, source: { kind: 'user-edit' as const, editedAt: now } });
  const updates: Partial<Profile['contact']> = {};

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

  if (Object.keys(updates).length === 0) return profile;

  const updated: Profile = { ...profile, contact: { ...profile.contact, ...updates } };

  // Persist to whichever profile is active
  if (await fileExists(refinedJsonPath(profileDir))) {
    const refined = await loadRefined(profileDir);
    await saveRefined({ ...refined, profile: updated }, profileDir);
  } else {
    await saveSource(updated, profileDir);
  }
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
      config = await buildConfig(options, inquirer, profileDir);
    }

    // Curate if JD provided; otherwise include everything
    const templateOverride = config.templateOverride;
    let resumeDoc;
    if (config.jd) {
      // Analyze JD (may already be in saved config)
      if (!config.jobAnalysis) {
        console.log(c.muted('\nAnalyzing job description...'));
        config.jobAnalysis = await analyzeJobDescription(config.jd);
        // Auto-save this JD for future reuse
        await autoSaveJob(config.jd, config.jobAnalysis.company, config.jobAnalysis.title, profileDir);
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
          config.company = config.jobAnalysis.company;
          config.jobTitle = config.jobAnalysis.title;
        }
      }

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

      console.log(c.muted('\nCurating resume with Claude...'));
      let curatorResult;
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

      const { plan } = curatorResult;
      console.log('\nCuration Summary:');
      console.log(`  ${c.label('Positions:')} ${plan.selectedPositions.length}`);
      for (const selPos of plan.selectedPositions) {
        const pos = profile.positions.find(p => p.id === selPos.positionId);
        console.log(`    ${c.muted('•')} ${pos?.title.value} ${c.muted(`@ ${pos?.company.value} (${selPos.bulletRefs.length} bullets)`)}`);
      }
      console.log(`  ${c.label('Skills:')}    ${plan.selectedSkillIds.length}`);
      console.log(`  ${c.label('Education:')} ${plan.selectedEducationIds.length}`);

      const { action } = await inquirer.prompt([
        {
          type: 'list', name: 'action', message: 'What would you like to do?',
          choices: [
            { value: 'generate', name: '✓ Generate PDF' },
            { value: 'edit', name: '✎ Edit refined data and re-curate' },
            { value: 'retry', name: '↻ Re-run curation' },
            { value: 'cancel', name: '✗ Cancel' },
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

      console.log(`\n${c.ok} ${c.success('Accuracy check passed')}`);
      resumeDoc = assembleResumeDocument(
        profile, plan, curatorResult.refMap,
        effectiveFlair, config.jobAnalysis.industry,
        config.jobTitle, config.company,
      );
    } else {
      // No JD — include everything
      const { effectiveFlair, effectiveTemplate } = getFlairInfo(config.flair, 'general');
      const displayTemplate = templateOverride ?? effectiveTemplate;
      console.log(`\n  ${c.label('Template:')} ${displayTemplate}${templateOverride ? '' : c.muted(` (flair ${effectiveFlair})`)}`);
      resumeDoc = assembleFullResumeDocument(profile, config);
    }

    // Apply template override (e.g. 'retro') regardless of flair-based selection
    if (templateOverride) resumeDoc = { ...resumeDoc, template: templateOverride };

    // Render and export
    console.log(c.muted('Rendering HTML...'));
    const html = await renderResumeHtml(resumeDoc);

    const safeName = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    const namePart = config.company
      ? `${safeName(config.company)}-${safeName(config.jobTitle)}`
      : safeName(config.jobTitle) || 'resume';
    const outputPath = `${resumesDir}/${namePart}-${date}.pdf`;

    // Check if content fits on one page
    console.log(c.muted('Checking page fit...'));
    const fit = await measurePageFit(html);
    let pdfScale = 1.0;

    if (fit.overflows) {
      const pct = Math.round(fit.ratio * 100);
      const recScale = Math.max(0.70, Math.round((1 / fit.ratio * 0.97) * 100) / 100);
      console.log(`\n${c.warn} ${c.warning(`Content is ~${pct}% of page height — some will be clipped.`)}`);

      const { fitAction } = await inquirer.prompt([
        {
          type: 'list', name: 'fitAction',
          message: 'Content exceeds one page. What would you like to do?',
          choices: [
            { value: 'autofit', name: `Auto-fit — scale to ${Math.round(recScale * 100)}% (recommended)` },
            { value: 'edit',    name: 'Edit content — trim resume data manually' },
            { value: 'anyway',  name: 'Generate anyway — content will be clipped at page edge' },
            { value: 'cancel',  name: 'Cancel' },
          ],
        },
      ]) as { fitAction: string };

      if (fitAction === 'cancel') break;
      if (fitAction === 'edit') {
        await editRefinedProfile(profileDir);
        reuseConfig = false;
        continue;
      }
      if (fitAction === 'autofit') pdfScale = recScale;
    }

    console.log(c.muted('Generating PDF...'));
    await exportToPdf(html, { template: resumeDoc.template, outputPath, scale: pdfScale });

    // Save config so this run is repeatable; stamp profile version for stale-check
    config.profileUpdatedAt = profile.updatedAt;
    await saveGenerationConfig(config, profileDir);
    console.log(`\n${c.ok} ${c.success('Resume generated:')} ${c.path(outputPath)}`);
    console.log(c.muted(`  Settings saved to ${generationConfigPath(profileDir)}`));

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
): Promise<GenerationConfig> {
  // JD — optional
  let jdText = options.jd;
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
      jdText = await pickSavedJob(inquirer, savedJobs, profileDir);
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
    const answers = await inquirer.prompt([
      { type: 'input', name: 'company', message: 'Target company (optional, for filename):' },
      { type: 'input', name: 'jobTitle', message: 'Target role / title (optional):', default: 'Resume' },
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
          { value: 'retro', name: '★ — Retro Terminal (amber-on-black, ASCII art)' },
        ],
        default: getRecommendedFlair('general'),
      },
    ]) as { selectedFlair: FlairLevel | 'retro' };

    if (selectedFlair === 'retro') {
      templateOverride = 'retro';
      flair = 1; // retro template ignores flair; use 1 as neutral default
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
): Promise<void> {
  const { createHash } = await import('crypto');
  const textHash = createHash('sha256').update(text).digest('hex');
  const job: SavedJob = {
    id: `job-${Date.now()}`,
    company,
    title,
    savedAt: new Date().toISOString(),
    text,
    textHash,
  };
  await saveJob(job, profileDir);
}

async function pickSavedJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inquirer: any,
  jobs: SavedJob[],
  profileDir: string,
): Promise<string | undefined> {
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

  return jobs.find(j => j.id === choice)?.text;
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
