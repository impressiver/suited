import { readFile } from 'node:fs/promises';
import {
  applyJobFeedback,
  enrichFindingsWithUserInput,
  evaluateForJob,
  printJobEvaluation,
  resumeDocContext,
} from '../generate/consultant.ts';
import { buildRefMapForProfile, curateForJob } from '../generate/curator.ts';
import {
  buildFitOverrideCss,
  SQUEEZE_THRESHOLDS,
  type SqueezeLevel,
} from '../generate/fit-adjuster.ts';
import { analyzeJobDescription } from '../generate/job-analyzer.ts';
import { extractLogomark, svgToDataUri } from '../generate/logo-extractor.ts';
import { discoverLogoSvgs, fetchSvgsFromUrl } from '../generate/logo-fetcher.ts';
import { polishResumeForJob, tweakResumeContent } from '../generate/polisher.ts';
import { renderResumeHtml } from '../generate/renderer.ts';
import {
  assembleFullResumeDocument,
  assembleResumeDocument,
  getFlairInfo,
  getRecommendedFlair,
} from '../generate/resume-builder.ts';
import { autoTrimToFit } from '../generate/trimmer.ts';
import { exportToPdf, measurePageFit } from '../pdf/exporter.ts';
import { markdownToProfile, profileToMarkdown } from '../profile/markdown.ts';
import type {
  FlairLevel,
  GenerationConfig,
  IndustryVertical,
  JobRefinement,
  Profile,
  ResumeDocument,
  SavedJob,
  TemplateName,
} from '../profile/schema.ts';
import {
  clearGenerationConfig,
  deleteJob,
  generationConfigPath,
  isMdNewerThanJson,
  jobRefinedJsonPath,
  jobRefinedMdPath,
  loadActiveProfile,
  loadGenerationConfig,
  loadJobRefinedProfile,
  loadJobRefinement,
  loadJobs,
  loadLogoCache,
  loadRefined,
  makeJobSlug,
  refinedJsonPath,
  refinedMdPath,
  saveGenerationConfig,
  saveJob,
  saveJobRefinedProfile,
  saveJobRefinement,
  saveLogoCache,
  saveRefined,
} from '../profile/serializer.ts';
import { c } from '../utils/colors.ts';
import { fileExists } from '../utils/fs.ts';
import { openInEditor } from '../utils/interactive.ts';
import { createSpinner } from '../utils/spinner.ts';

export interface GenerateOptions {
  profileDir?: string;
  output?: string;
  jd?: string;
  flair?: string;
}

const INDUSTRY_LABELS: Record<IndustryVertical, string> = {
  'software-engineering': 'Software Engineering',
  finance: 'Finance',
  design: 'Design',
  marketing: 'Marketing',
  consulting: 'Consulting',
  academia: 'Academia',
  healthcare: 'Healthcare',
  legal: 'Legal',
  general: 'General',
  ai: 'AI / Machine Learning',
};

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  const profileDir = options.profileDir ?? 'output';
  const resumesDir = options.output ?? `${profileDir}/resumes`;

  // Detect external edits to refined.md — sync to JSON before generating
  if (await isMdNewerThanJson(refinedMdPath(profileDir), refinedJsonPath(profileDir))) {
    console.log(`\n${c.warn} ${c.warning('refined.md has been modified outside the CLI.')}`);
    const { sync } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'sync',
        message: 'Reload refined.json from the edited markdown and re-run from this step?',
        default: true,
      },
    ])) as { sync: boolean };
    if (sync) {
      const existing = await loadRefined(profileDir);
      const updatedProfile = await markdownToProfile(refinedMdPath(profileDir), existing.profile);
      await saveRefined({ profile: updatedProfile, session: existing.session }, profileDir);
      console.log(`${c.ok} ${c.success('refined.json updated from refined.md.')}`);
    }
  }

  // Load the best available profile (refined → source)
  const profile = await loadActiveProfile(profileDir);
  const usingRefined = await fileExists(refinedJsonPath(profileDir));

  console.log(
    `${c.ok} Loaded ${c.muted(usingRefined ? 'refined' : 'source')} profile: ${c.value(profile.contact.name.value)}`,
  );
  console.log(
    c.muted(
      `  ${profile.positions.length} positions · ${profile.skills.length} skills · ${profile.education.length} education entries`,
    ),
  );
  if (!usingRefined) {
    console.log(
      c.tip("  Tip: run 'resume refine' first to improve your profile with Claude's help."),
    );
  }

  // Check for saved generation config — discard it if the profile has changed
  const savedConfig = await loadGenerationConfig(profileDir);
  let reuseConfig = false;

  if (savedConfig) {
    const profileChanged =
      savedConfig.profileUpdatedAt !== undefined &&
      savedConfig.profileUpdatedAt !== profile.updatedAt;

    if (profileChanged) {
      console.log(
        `\n${c.warn} ${c.warning('Profile data has changed — previous generation settings have been discarded.')}`,
      );
      await clearGenerationConfig(profileDir);
    } else {
      const configDate = new Date(savedConfig.updatedAt).toLocaleDateString();
      const target = savedConfig.company
        ? `${savedConfig.company} — ${savedConfig.jobTitle}`
        : savedConfig.jobTitle || 'general resume';
      console.log(
        `\n${c.muted('Previous generation:')} ${c.value(target)} ${c.muted(`(${configDate}, flair ${savedConfig.flair})`)}`,
      );

      const { reuse } = (await inquirer.prompt([
        { type: 'confirm', name: 'reuse', message: 'Use the same settings?', default: true },
      ])) as { reuse: boolean };
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
    let resumeDoc: ResumeDocument | undefined;
    if (config.jd) {
      // [1/4] Analyze JD (may already be in saved config)
      if (!config.jobAnalysis) {
        const spinner1 = createSpinner('[1/4] Reading the job posting tea leaves...');
        config.jobAnalysis = await analyzeJobDescription(config.jd);
        spinner1.stop();
        // Auto-save this JD and capture the job ID
        const savedId = await autoSaveJob(
          config.jd,
          config.jobAnalysis.company,
          config.jobAnalysis.title,
          profileDir,
        );
        if (!config.jobId) config.jobId = savedId;
      } else {
        console.log(c.muted('[1/4] Job analysis (from saved config)'));
      }

      const { jobAnalysis } = config;
      console.log('\nJob Analysis:');
      console.log(`  ${c.label('Company:')}    ${jobAnalysis.company}`);
      console.log(`  ${c.label('Title:')}      ${jobAnalysis.title}`);
      console.log(`  ${c.label('Industry:')}   ${INDUSTRY_LABELS[jobAnalysis.industry]}`);
      console.log(`  ${c.label('Seniority:')}  ${jobAnalysis.seniority}`);
      console.log(`  ${c.label('Key Skills:')} ${jobAnalysis.keySkills.slice(0, 6).join(', ')}`);

      if (!reuseConfig) {
        const { ok } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'ok',
            message: 'Does this analysis look correct?',
            default: true,
          },
        ])) as { ok: boolean };

        if (!ok) {
          const overrides = (await inquirer.prompt([
            {
              type: 'input',
              name: 'company',
              message: 'Company name:',
              default: jobAnalysis.company,
            },
            { type: 'input', name: 'title', message: 'Job title:', default: jobAnalysis.title },
            {
              type: 'list',
              name: 'industry',
              message: 'Industry:',
              choices: Object.entries(INDUSTRY_LABELS).map(([v, n]) => ({ value: v, name: n })),
              default: jobAnalysis.industry,
            },
          ])) as Partial<typeof jobAnalysis>;
          config.jobAnalysis = { ...jobAnalysis, ...overrides };
        }
      }
      // Always sync company/jobTitle from the (possibly overridden) analysis
      config.company = config.jobAnalysis.company;
      config.jobTitle = config.jobAnalysis.title;

      const { effectiveFlair, effectiveTemplate, warning } = getFlairInfo(
        config.flair,
        config.jobAnalysis.industry,
      );
      if (warning) {
        console.log(`\n${c.warn} ${c.warning(warning)}`);
        const { proceed } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: `Proceed with classic template (flair ${effectiveFlair})?`,
            default: true,
          },
        ])) as { proceed: boolean };
        if (!proceed) {
          reuseConfig = false;
          continue;
        }
      }
      console.log(
        `  ${c.label('Template:')} ${effectiveTemplate} ${c.muted(`(flair ${effectiveFlair})`)}`,
      );

      // Check for manually-edited job-specific refined profile
      const jobSlug = makeJobSlug(config.company, config.jobTitle);
      let useEditedJobProfile = false;
      if (
        await isMdNewerThanJson(
          jobRefinedMdPath(profileDir, jobSlug),
          jobRefinedJsonPath(profileDir, jobSlug),
        )
      ) {
        console.log(`\n${c.warn} ${c.warning(`jobs/${jobSlug}/refined.md has been modified.`)}`);
        const { useMd } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'useMd',
            message:
              'Use your manual edits as the starting profile instead of re-running curation?',
            default: true,
          },
        ])) as { useMd: boolean };
        if (useMd) {
          const existingProfile = await loadJobRefinedProfile(profileDir, jobSlug);
          if (existingProfile) {
            const editedProfile = await markdownToProfile(
              jobRefinedMdPath(profileDir, jobSlug),
              existingProfile,
            );
            await saveJobRefinedProfile(editedProfile, profileDir, jobSlug);
            resumeDoc = assembleFullResumeDocument(editedProfile, config);
            useEditedJobProfile = true;
          }
        }
      }

      if (!useEditedJobProfile) {
        // [2/4] Curation — with in-session re-run support (Phase 3 preview)
        let curatorResult: import('../generate/curator.ts').CuratorResult | undefined;
        let usedStoredRefinement = false;
        let skipStoredForThisRun = false;
        let previewApproved = false;

        while (!previewApproved) {
          // Load stored refinement if available (unless user just re-ran curation)
          if (config.jobId && !curatorResult && !skipStoredForThisRun) {
            const stored = await loadJobRefinement(profileDir, config.jobId);
            if (stored) {
              console.log(
                c.muted(
                  `\nUsing stored job refinement from ${new Date(stored.createdAt).toLocaleDateString()}...`,
                ),
              );
              curatorResult = { plan: stored.plan, refMap: buildRefMapForProfile(profile) };
              usedStoredRefinement = true;
            }
          }

          if (!curatorResult) {
            const spinner2 = createSpinner('[2/4] Handpicking your finest career moments...');
            try {
              curatorResult = await curateForJob(profile, config.jobAnalysis);
              spinner2.stop();
            } catch (err) {
              spinner2.stop();
              console.error(`\n${c.fail} ${c.error(`Curation failed: ${(err as Error).message}`)}`);
              const { retry } = (await inquirer.prompt([
                { type: 'confirm', name: 'retry', message: 'Retry curation?', default: true },
              ])) as { retry: boolean };
              if (retry) {
                reuseConfig = false;
                continue;
              }
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
          } else {
            console.log(c.muted('[2/4] Curation (from stored refinement)'));
          }

          // Phase 3: Bullet-level preview before section checkboxes
          const { plan } = curatorResult;
          const _selectedPosIds = new Set(plan.selectedPositions.map((p) => p.positionId));
          console.log(
            `\n  ${c.header(`Curated for: ${config.jobAnalysis.title} @ ${config.jobAnalysis.company}`)}\n`,
          );
          console.log(
            `  ${c.label('Experience')}  ${c.muted(`(${plan.selectedPositions.length} of ${profile.positions.length} positions)`)}`,
          );
          for (const pos of profile.positions) {
            const sel = plan.selectedPositions.find((s) => s.positionId === pos.id);
            const dateRange = `${pos.startDate.value}–${pos.endDate?.value ?? 'Present'}`;
            if (sel) {
              console.log(
                `    ${c.ok} ${c.value(pos.title.value)} ${c.muted(`@ ${pos.company.value}`)}  ${c.muted(dateRange)}`,
              );
              for (const ref of sel.bulletRefs) {
                const parts = ref.split(':');
                if (parts.length >= 3) {
                  const bulletIdx = parseInt(parts[2], 10);
                  const bullet = pos.bullets[bulletIdx];
                  if (bullet) {
                    const preview =
                      bullet.value.length > 90 ? `${bullet.value.slice(0, 90)}…` : bullet.value;
                    console.log(`        ${c.muted('·')} ${preview}`);
                  }
                }
              }
            } else {
              console.log(
                `    ${c.muted(`✕ ${pos.title.value} @ ${pos.company.value}  ${dateRange}`)}`,
              );
            }
          }

          if (plan.selectedSkillIds.length > 0) {
            const skillNames = profile.skills
              .filter((s) => plan.selectedSkillIds.includes(s.id))
              .map((s) => s.name.value);
            console.log(
              `\n  ${c.label('Skills')}  ${c.muted(`(${skillNames.length})`)}  ${skillNames.join(', ')}`,
            );
          }
          if (plan.selectedEducationIds.length > 0) {
            const edus = profile.education
              .filter((e) => plan.selectedEducationIds.includes(e.id))
              .map((e) =>
                [e.degree?.value, e.fieldOfStudy?.value, '—', e.institution.value]
                  .filter(Boolean)
                  .join(' '),
              );
            console.log(
              `  ${c.label('Education')}  ${c.muted(`(${edus.length})`)}  ${edus.join(' | ')}`,
            );
          }
          console.log('');

          const { previewAction } = (await inquirer.prompt([
            {
              type: 'list',
              loop: false,
              name: 'previewAction',
              message: 'Curation preview:',
              choices: [
                { value: 'continue', name: '[Enter] Continue' },
                { value: 'rerun', name: '[r] Re-run curation' },
              ],
            },
          ])) as { previewAction: string };

          if (previewAction === 'rerun') {
            // Clear in-session result; don't load from disk next iteration
            curatorResult = undefined;
            usedStoredRefinement = false;
            skipStoredForThisRun = true;
          } else {
            previewApproved = true;
          }
        }

        if (!curatorResult) break; // curation aborted

        const { plan } = curatorResult;
        console.log(`\n${c.ok} ${c.success('Accuracy check passed')}`);
        resumeDoc = assembleResumeDocument(
          profile,
          plan,
          curatorResult.refMap,
          effectiveFlair,
          config.jobAnalysis.industry,
          config.jobTitle,
          config.company,
        );

        // [3/4] Auto-polish bullets — no user interaction, no facts added
        const spinner3 = createSpinner('[3/4] Buffing the bullets to a mirror shine...');
        try {
          resumeDoc = await polishResumeForJob(resumeDoc, config.jobAnalysis);
          spinner3.stop();
        } catch (err) {
          spinner3.stop();
          console.log(c.muted(`  Polish skipped (${(err as Error).message})`));
        }

        // [4/4] Hiring consultant evaluation — skip if reusing config with stored refinement
        if (!reuseConfig || !usedStoredRefinement) {
          const spinner4 = createSpinner(
            '[4/4] Getting a second opinion from our imaginary consultant...',
          );
          try {
            const jobEval = await evaluateForJob(resumeDoc, config.jobAnalysis);
            spinner4.stop();
            printJobEvaluation(jobEval);

            if (jobEval.gaps.length > 0) {
              const { feedbackAction } = (await inquirer.prompt([
                {
                  type: 'list',
                  loop: false,
                  name: 'feedbackAction',
                  message: 'Incorporate consultant feedback?',
                  choices: [
                    { value: 'skip', name: 'Skip' },
                    { value: 'all', name: 'Apply all suggestions' },
                    { value: 'pick', name: 'Choose which suggestions to apply' },
                  ],
                },
              ])) as { feedbackAction: string };

              if (feedbackAction !== 'skip') {
                let selectedGaps = jobEval.gaps;
                if (feedbackAction === 'pick') {
                  const { chosen } = (await inquirer.prompt([
                    {
                      type: 'checkbox',
                      name: 'chosen',
                      message: 'Select suggestions to apply:',
                      choices: jobEval.gaps.map((gap, i) => ({
                        name: `${gap.area}: ${gap.issue}`,
                        value: i,
                        checked: true,
                      })),
                    },
                  ])) as { chosen: number[] };
                  selectedGaps = chosen.map((i) => jobEval.gaps[i]);
                }

                if (selectedGaps.length > 0) {
                  selectedGaps = await enrichFindingsWithUserInput(
                    selectedGaps,
                    inquirer,
                    resumeDocContext(resumeDoc),
                  );
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
            spinner4.stop();
            console.log(c.muted(`  Job fit review unavailable: ${(err as Error).message}`));
          }
        } else {
          console.log(c.muted('[4/4] Job fit review skipped (using stored evaluation)'));
        }
      } // end !useEditedJobProfile

      // Save job-specific refined profile for future manual editing
      if (!useEditedJobProfile && resumeDoc) {
        const jobProfile = resumeDocToJobProfile(resumeDoc, profile);
        await Promise.all([
          saveJobRefinedProfile(jobProfile, profileDir, jobSlug),
          profileToMarkdown(jobProfile, jobRefinedMdPath(profileDir, jobSlug)),
        ]);
        console.log(c.muted(`  Saved curated profile → jobs/${jobSlug}/refined.md`));
      }
    } else {
      // No JD — include everything
      const { effectiveFlair, effectiveTemplate } = getFlairInfo(config.flair, 'general');
      const displayTemplate = templateOverride ?? effectiveTemplate;
      console.log(
        `\n  ${c.label('Template:')} ${displayTemplate}${templateOverride ? '' : c.muted(` (flair ${effectiveFlair})`)}`,
      );
      resumeDoc = assembleFullResumeDocument(profile, config);
    }

    if (!resumeDoc) continue;

    // Apply template override (e.g. 'retro') regardless of flair-based selection
    if (templateOverride) resumeDoc = { ...resumeDoc, template: templateOverride };

    // For timeline: interactively collect logos (ask user for URLs on low-confidence results)
    if (resumeDoc.template === 'timeline' && !resumeDoc.logoDataUris) {
      resumeDoc = {
        ...resumeDoc,
        logoDataUris: await collectTimelineLogos(resumeDoc, inquirer, profileDir),
      };
    }

    // Section / experience selection always shown before the final generate confirm
    {
      const sectionResult = await selectSections(
        resumeDoc,
        inquirer,
        reuseConfig ? config.sectionSelection : undefined,
      );
      resumeDoc = sectionResult.doc;
      config.sectionSelection = sectionResult.selected;
    }

    // For JD-targeted resumes, confirm generation after sections are chosen.
    // "Generate PDF" is now the last interactive step before file I/O.
    if (config.jd) {
      const { action } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { value: 'generate', name: '✓ Generate PDF' },
            { value: 'edit', name: '✎ Edit refined data and re-curate' },
            { value: 'retry', name: '↻ Re-run curation (refresh stored refinement)' },
            { value: 'cancel', name: '✗ Cancel' },
          ],
        },
      ])) as { action: string };

      if (action === 'cancel') break;
      if (action === 'retry') {
        reuseConfig = false;
        continue;
      }
      if (action === 'edit') {
        await editRefinedProfile(profileDir);
        reuseConfig = false;
        continue;
      }
      // 'generate' falls through to file generation below
    }

    const safeName = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const nowTs = new Date();
    const date = nowTs.toISOString().slice(0, 10);
    const hhmm = nowTs.toTimeString().slice(0, 5).replace(':', '');

    const personSlug = safeName(profile.contact.name.value);
    const fileBaseName = `${personSlug}-resume`;

    const jobSlug = config.company ? makeJobSlug(config.company, config.jobTitle ?? '') : null;
    const resumeOutputDir = jobSlug ? `${resumesDir}/${jobSlug}` : resumesDir;

    if (config.allTemplates) {
      // Generate one PDF per template
      console.log(c.muted('\nGenerating all templates...'));
      const generatedPaths = await generateAllTemplates(
        resumeDoc,
        fileBaseName,
        resumeOutputDir,
        inquirer,
        profileDir,
      );
      config.profileUpdatedAt = profile.updatedAt;
      config.resolvedTemplate = resumeDoc.template;
      await saveGenerationConfig(config, profileDir);
      console.log(`\n${c.ok} ${c.success(`Generated ${generatedPaths.length} resume(s).`)}`);
      console.log(c.muted(`  Settings saved to ${generationConfigPath(profileDir)}`));
    } else {
      // Single template — render, fit-check, export
      let outputPath = `${resumeOutputDir}/${fileBaseName}_${date}-${hhmm}.pdf`;
      let html = await renderResumeHtml(resumeDoc);

      let fitCancelled = false;
      console.log(c.muted('Checking page fit...'));
      html = await trySqueeze(html, resumeDoc);

      while (true) {
        // eslint-disable-line no-constant-condition
        const fit = await measurePageFit(html);
        if (!fit.overflows) break;

        const pct = Math.round(fit.ratio * 100);
        console.log(
          `\n${c.warn} ${c.warning(`Still ~${pct}% of page height after layout adjustments.`)}`,
        );
        const { fitAction } = (await inquirer.prompt([
          {
            type: 'list',
            name: 'fitAction',
            message: 'Content still exceeds one page. What would you like to do?',
            choices: [
              { value: 'auto', name: 'Auto-trim to fit (AI picks what to cut)' },
              { value: 'trim', name: 'Remove sections or entries manually' },
              { value: 'anyway', name: 'Generate anyway — content will be clipped at page edge' },
              { value: 'cancel', name: 'Cancel' },
            ],
          },
        ])) as { fitAction: string };

        if (fitAction === 'cancel') {
          fitCancelled = true;
          break;
        }
        if (fitAction === 'anyway') break;
        if (fitAction === 'auto') {
          console.log(c.muted('  Asking AI to trim content to fit...'));
          try {
            resumeDoc = await autoTrimToFit(resumeDoc, fit.ratio);
          } catch (err) {
            console.log(
              c.muted(`  Auto-trim failed (${(err as Error).message}) — falling back to manual.`),
            );
            ({ doc: resumeDoc, selected: config.sectionSelection } = await selectSections(
              resumeDoc,
              inquirer,
            ));
          }
        } else {
          ({ doc: resumeDoc, selected: config.sectionSelection } = await selectSections(
            resumeDoc,
            inquirer,
          ));
        }
        html = await renderResumeHtml(resumeDoc);
        html = await trySqueeze(html, resumeDoc);
      }
      if (fitCancelled) break;

      console.log(c.muted('Generating PDF...'));
      await exportToPdf(html, { template: resumeDoc.template, outputPath });

      // Save config; stamp resolved template + profile version
      config.profileUpdatedAt = profile.updatedAt;
      config.resolvedTemplate = resumeDoc.template;
      await saveGenerationConfig(config, profileDir);
      console.log(`\n${c.ok} ${c.success('Resume is ready to ship:')} ${c.path(outputPath)}`);
      console.log(c.muted(`  Settings saved · ${generationConfigPath(profileDir)}`));

      // -----------------------------------------------------------------------
      // "What next?" inner loop — handles open, tweak, template without
      // re-running the full curation flow.
      // -----------------------------------------------------------------------
      let innerLoop = true;
      while (innerLoop) {
        const { next } = (await inquirer.prompt([
          {
            type: 'list',
            name: 'next',
            message: "What's next?",
            choices: [
              { value: 'done', name: `${c.ok} Done — looks great!` },
              {
                value: 'open',
                name: `Open PDF                 ${c.muted('(open in default viewer)')}`,
              },
              {
                value: 'tweak',
                name: `Tweak content            ${c.muted('(natural language → Claude rewrites)')}`,
              },
              {
                value: 'template',
                name: `Change template          ${c.muted(`(currently: ${resumeDoc.template})`)}`,
              },
              {
                value: 'newjd',
                name: `Target a different job   ${c.muted('(start fresh with a new JD)')}`,
              },
              {
                value: 'edit',
                name: `Edit profile data        ${c.muted('(opens editor, re-curates)')}`,
              },
            ],
          },
        ])) as { next: string };

        if (next === 'done') {
          innerLoop = false;
          continueLoop = false;
        } else if (next === 'open') {
          await openPdf(outputPath);
        } else if (next === 'tweak') {
          const { instruction } = (await inquirer.prompt([
            {
              type: 'input',
              name: 'instruction',
              message:
                'What would you like to change?\n  (e.g. "tighten the bullets", "emphasize leadership", "remove mentions of Python")\n>',
            },
          ])) as { instruction: string };
          if (instruction.trim()) {
            const spinner = createSpinner('Applying tweak...');
            try {
              resumeDoc = await tweakResumeContent(resumeDoc, instruction.trim());
              spinner.stop();
            } catch (err) {
              spinner.stop();
              console.log(c.muted(`  Tweak failed: ${(err as Error).message}`));
              continue;
            }
            const newNowTs = new Date();
            const newDate = newNowTs.toISOString().slice(0, 10);
            const newHhmm = newNowTs.toTimeString().slice(0, 5).replace(':', '');
            outputPath = `${resumeOutputDir}/${fileBaseName}-${newDate}-${newHhmm}.pdf`;
            let tweakedHtml = await renderResumeHtml(resumeDoc);
            tweakedHtml = await trySqueeze(tweakedHtml, resumeDoc);
            await exportToPdf(tweakedHtml, { template: resumeDoc.template, outputPath });
            console.log(`${c.ok} ${c.success('Tweaked and ready:')} ${c.path(outputPath)}`);
            console.log(
              c.muted('  (Previous PDF still exists with its original timestamp — no work lost.)'),
            );
          }
        } else if (next === 'template') {
          const { newTemplate } = (await inquirer.prompt([
            {
              type: 'list',
              name: 'newTemplate',
              message: 'Choose template:',
              choices: [
                { value: 'classic', name: 'Classic' },
                { value: 'modern', name: 'Modern' },
                { value: 'bold', name: 'Bold' },
                { value: 'retro', name: 'Retro Terminal' },
                { value: 'timeline', name: 'Timeline' },
              ],
              default: resumeDoc.template,
            },
          ])) as { newTemplate: TemplateName };
          if (newTemplate === 'timeline' && !resumeDoc.logoDataUris) {
            resumeDoc = {
              ...resumeDoc,
              logoDataUris: await collectTimelineLogos(resumeDoc, inquirer, profileDir),
            };
          }
          resumeDoc = { ...resumeDoc, template: newTemplate };
          config.resolvedTemplate = newTemplate;
          await saveGenerationConfig(config, profileDir);
          console.log(c.muted(`Generating PDF with ${newTemplate} template...`));
          const newNowTs = new Date();
          const newDate = newNowTs.toISOString().slice(0, 10);
          const newHhmm = newNowTs.toTimeString().slice(0, 5).replace(':', '');
          outputPath = `${resumeOutputDir}/${fileBaseName}-${newDate}-${newHhmm}.pdf`;
          let templateHtml = await renderResumeHtml(resumeDoc);
          templateHtml = await trySqueeze(templateHtml, resumeDoc);
          await exportToPdf(templateHtml, { template: resumeDoc.template, outputPath });
          console.log(`${c.ok} ${c.success('Resume generated:')} ${c.path(outputPath)}`);
        } else if (next === 'newjd') {
          reuseConfig = false;
          options.jd = undefined;
          options.flair = undefined;
          innerLoop = false;
        } else if (next === 'edit') {
          await editRefinedProfile(profileDir);
          reuseConfig = false;
          innerLoop = false;
        }
      }
    }

    // If inner loop ran, continueLoop is already set by the 'done' case
    // For the allTemplates path we still need the old "What next?" behavior
    if (config.allTemplates) {
      const { next } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'next',
          message: 'What next?',
          choices: [
            { value: 'done', name: 'Done' },
            { value: 'newjd', name: 'Target a different job' },
            { value: 'edit', name: 'Edit profile data and regenerate' },
          ],
        },
      ])) as { next: string };
      if (next === 'done') {
        continueLoop = false;
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
}

// ---------------------------------------------------------------------------
// Open PDF with the OS default viewer
// ---------------------------------------------------------------------------

async function openPdf(filePath: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open "${filePath}"`);
  } else if (platform === 'linux') {
    exec(`xdg-open "${filePath}"`);
  } else {
    console.log(c.muted(`  (Cannot auto-open on ${platform} — open manually: ${filePath})`));
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
        ? [
            {
              name: `Saved job descriptions  ${c.muted(`(${savedJobs.length} saved)`)}`,
              value: 'saved',
            },
          ]
        : []),
      { name: 'Paste / type text', value: 'paste' },
      { name: 'File path', value: 'file' },
      { name: 'Skip — generate full resume (no job targeting)', value: 'skip' },
    ];

    const { jdSource } = (await inquirer.prompt([
      { type: 'list', name: 'jdSource', message: 'Job description:', choices },
    ])) as { jdSource: string };

    if (jdSource === 'saved') {
      const result = await pickSavedJob(inquirer, savedJobs, profileDir);
      if (result) {
        jdText = result.text;
        selectedJobId = result.id;
      }
    } else if (jdSource === 'paste') {
      const { jd } = (await inquirer.prompt([
        {
          type: 'editor',
          name: 'jd',
          message: 'Paste the job description (save and close editor):',
        },
      ])) as { jd: string };
      jdText = jd;
    } else if (jdSource === 'file') {
      const { filePath } = (await inquirer.prompt([
        { type: 'input', name: 'filePath', message: 'Path to job description file:' },
      ])) as { filePath: string };
      jdText = await readFile(filePath, 'utf-8');
    }
    // 'skip' → jdText remains undefined
  }

  // Company / title (for filename + header when no JD)
  let company = '';
  let jobTitle = 'Resume';
  if (!jdText) {
    const headlineDefault = profile?.contact.headline?.value ?? 'Resume';
    const answers = (await inquirer.prompt([
      { type: 'input', name: 'company', message: 'Target company (optional, for filename):' },
      {
        type: 'input',
        name: 'jobTitle',
        message: 'Target role / title (optional):',
        default: headlineDefault,
      },
    ])) as { company: string; jobTitle: string };
    company = answers.company;
    jobTitle = answers.jobTitle;
  }

  // Flair
  let flair: FlairLevel = options.flair ? (parseInt(options.flair, 10) as FlairLevel) : 3;

  let templateOverride: import('../profile/schema.ts').TemplateName | undefined;

  if (!options.flair) {
    const { selectedFlair } = (await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedFlair',
        message: 'Select flair level:',
        choices: [
          { value: 1, name: '1 — Classic (ATS-safe, serif, no color)' },
          { value: 2, name: '2 — Classic+ (clean, minimal accents)' },
          { value: 3, name: '3 — Modern (accent color, sans-serif)' },
          { value: 4, name: '4 — Modern+ (bolder accents, pill skills)' },
          { value: 5, name: '5 — Bold (full sidebar, color block)' },
          { value: 'retro', name: '★ — Retro Terminal (amber-on-black, ASCII art)' },
          { value: 'timeline', name: '◈ — Timeline (dark header, prose entries, two-column)' },
          { value: 'all', name: '⊞ — All templates (generate one PDF per template)' },
        ],
        default: getRecommendedFlair('general'),
      },
    ])) as { selectedFlair: FlairLevel | 'retro' | 'timeline' | 'all' };

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
  const { createHash } = await import('node:crypto');
  const textHash = createHash('sha256').update(text).digest('hex');
  // If already saved, return the existing job's ID
  const existing = await loadJobs(profileDir);
  const dup = existing.find((j) => j.textHash === textHash);
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
  const { choice } = (await inquirer.prompt([
    {
      type: 'list',
      loop: false,
      name: 'choice',
      message: 'Choose a saved job description:',
      choices: [
        ...jobs.map((j) => ({
          name: `${j.company} — ${j.title}  ${c.muted(new Date(j.savedAt).toLocaleDateString())}`,
          value: j.id,
        })),
        { name: c.muted('Delete a saved JD…'), value: '__delete__' },
        { name: c.muted('← Back'), value: '__back__' },
      ],
    },
  ])) as { choice: string };

  if (choice === '__back__') return undefined;

  if (choice === '__delete__') {
    const { toDelete } = (await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'toDelete',
        message: 'Select JDs to delete:',
        choices: jobs.map((j) => ({
          name: `${j.company} — ${j.title}  ${c.muted(new Date(j.savedAt).toLocaleDateString())}`,
          value: j.id,
        })),
      },
    ])) as { toDelete: string[] };
    for (const id of toDelete) await deleteJob(id, profileDir);
    console.log(c.muted(`  Deleted ${toDelete.length} saved JD(s).`));
    // Re-show the picker with the updated list
    const updated = await loadJobs(profileDir);
    if (updated.length === 0) return undefined;
    return pickSavedJob(inquirer, updated, profileDir);
  }

  const job = jobs.find((j) => j.id === choice);
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
  savedSelection?: string[],
): Promise<{ doc: ResumeDocument; selected: string[] }> {
  const savedSet = savedSelection ? new Set(savedSelection) : null;

  // Build a merged list: individual position items + other sections
  type Choice = { name: string; value: string; checked: boolean };
  const choices: Choice[] = [
    ...(doc.summary
      ? [{ name: 'Summary', value: 'summary', checked: savedSet ? savedSet.has('summary') : true }]
      : []),
    // Individual position entries replace a single "Experience" item
    ...doc.positions.map((p, i) => ({
      name: `${p.title} @ ${p.company}  ${c.muted(`${p.startDate} – ${p.endDate ?? 'Present'} · ${p.bullets.length} bullet${p.bullets.length === 1 ? '' : 's'}`)}`,
      value: `pos:${i}`,
      checked: savedSet ? savedSet.has(`pos:${i}`) : true,
    })),
    ...(doc.education.length
      ? [
          {
            name: `Education  (${doc.education.length})`,
            value: 'education',
            checked: savedSet ? savedSet.has('education') : true,
          },
        ]
      : []),
    ...(doc.skills.length
      ? [
          {
            name: `Skills  (${doc.skills.length})`,
            value: 'skills',
            checked: savedSet ? savedSet.has('skills') : true,
          },
        ]
      : []),
    ...(doc.projects.length
      ? [
          {
            name: `Projects  (${doc.projects.length})`,
            value: 'projects',
            checked: savedSet ? savedSet.has('projects') : true,
          },
        ]
      : []),
    ...(doc.certifications.length
      ? [
          {
            name: `Certifications  (${doc.certifications.length})`,
            value: 'certifications',
            checked: savedSet ? savedSet.has('certifications') : true,
          },
        ]
      : []),
    ...(doc.languages.length
      ? [
          {
            name: `Languages  (${doc.languages.length})`,
            value: 'languages',
            checked: savedSet ? savedSet.has('languages') : true,
          },
        ]
      : []),
    ...(doc.volunteer.length
      ? [
          {
            name: `Volunteer  (${doc.volunteer.length})`,
            value: 'volunteer',
            checked: savedSet ? savedSet.has('volunteer') : true,
          },
        ]
      : []),
    ...(doc.awards.length
      ? [
          {
            name: `Awards  (${doc.awards.length})`,
            value: 'awards',
            checked: savedSet ? savedSet.has('awards') : true,
          },
        ]
      : []),
  ];

  const { selected } = (await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select sections and experience entries to include:',
      choices,
    },
  ])) as { selected: string[] };

  const enabled = new Set(selected);

  // Derive selected position indices from pos:N values
  const selectedPosIdxs = selected
    .filter((v) => v.startsWith('pos:'))
    .map((v) => parseInt(v.slice(4), 10))
    .sort((a, b) => a - b);

  // Gap-fill: positions are newest-first; include every entry between selected extremes
  const selectedPositions: ResumeDocument['positions'] = [];
  if (selectedPosIdxs.length > 0) {
    const maxIdx = Math.max(...selectedPosIdxs);
    const selectedSet = new Set(selectedPosIdxs);
    const autoFilled: string[] = [];
    for (let i = 0; i <= maxIdx; i++) {
      if (!selectedSet.has(i)) autoFilled.push(doc.positions[i]?.company ?? '');
    }
    if (autoFilled.length > 0) {
      console.log(
        `  ${c.warn} ${c.warning(`Re-included to avoid employment gaps: ${autoFilled.join(', ')}`)}`,
      );
    }
    for (let i = 0; i <= maxIdx; i++) {
      selectedPositions.push(doc.positions[i]);
    }
  }

  return {
    doc: {
      ...doc,
      summary: enabled.has('summary') ? doc.summary : undefined,
      positions: selectedPositions,
      education: enabled.has('education') ? doc.education : [],
      skills: enabled.has('skills') ? doc.skills : [],
      projects: enabled.has('projects') ? doc.projects : [],
      certifications: enabled.has('certifications') ? doc.certifications : [],
      languages: enabled.has('languages') ? doc.languages : [],
      volunteer: enabled.has('volunteer') ? doc.volunteer : [],
      awards: enabled.has('awards') ? doc.awards : [],
    },
    selected,
  };
}

// ---------------------------------------------------------------------------
// Generate all templates at once
// ---------------------------------------------------------------------------

const ALL_TEMPLATE_CONFIGS: Array<{
  template: import('../profile/schema.ts').TemplateName;
  flair: FlairLevel;
  label: string;
}> = [
  { template: 'classic', flair: 2, label: 'classic' },
  { template: 'modern', flair: 3, label: 'modern' },
  { template: 'bold', flair: 5, label: 'bold' },
  { template: 'timeline', flair: 4, label: 'timeline' },
  { template: 'retro', flair: 1, label: 'retro' },
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
    while (true) {
      // eslint-disable-line no-constant-condition
      const fit = await measurePageFit(html);
      if (!fit.overflows) break;

      const { fitAction } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'fitAction',
          message: `  [${tc.label}] Still ~${Math.round(fit.ratio * 100)}% after layout adjustments. What to do?`,
          choices: [
            { value: 'auto', name: 'Auto-trim to fit (AI picks what to cut)' },
            { value: 'trim', name: 'Remove sections or entries manually' },
            { value: 'anyway', name: 'Generate anyway (clipped)' },
            { value: 'skip', name: 'Skip this template' },
          ],
        },
      ])) as { fitAction: string };

      if (fitAction === 'skip') {
        skip = true;
        break;
      }
      if (fitAction === 'anyway') {
        break;
      }
      if (fitAction === 'auto') {
        console.log(c.muted(`  Asking AI to trim ${tc.label} to fit...`));
        try {
          currentBase = await autoTrimToFit(currentBase, fit.ratio);
        } catch (err) {
          console.log(
            c.muted(`  Auto-trim failed (${(err as Error).message}) — falling back to manual.`),
          );
          ({ doc: currentBase } = await selectSections(currentBase, inquirer));
        }
      } else {
        ({ doc: currentBase } = await selectSections(currentBase, inquirer));
      }
      doc = { ...currentBase, template: tc.template, flair: tc.flair };
      html = await renderResumeHtml(doc);
      html = await trySqueeze(html, doc);
    }

    if (skip) {
      console.log(c.muted(`    Skipped ${tc.label}.`));
      continue;
    }

    const outputPath = `${resumesDir}/${namePart}-${tc.label}_${date}-${hhmm}.pdf`;
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
    console.log(
      c.muted(
        `  Applied max layout adjustments (${Math.round(initial.ratio * 100)}% → ${Math.round(finalFit.ratio * 100)}%)`,
      ),
    );
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
    ...doc.positions.map((p) => p.company),
    ...doc.education.map((e) => e.institution),
  ];
  const unique = [...new Set(names)];

  // Load persisted cache — skip fetching for already-resolved names
  const cache = await loadLogoCache(profileDir);
  const logoUris: Record<string, string> = { ...cache };
  const toFetch = unique.filter((n) => !cache[n]);

  if (toFetch.length === 0) {
    console.log(c.muted('\nUsing cached logomarks for all companies.'));
    return logoUris;
  }

  console.log(c.muted('\nFetching company logomarks...'));

  const needsUrl: string[] = [];

  // Phase 1: auto-discover SVGs from guessed domain and extract logomark
  await Promise.all(
    toFetch.map(async (name) => {
      const svgs = await discoverLogoSvgs(name);
      for (const svg of svgs) {
        const logomark = await extractLogomark(svg);
        if (logomark) {
          logoUris[name] = svgToDataUri(logomark);
          return;
        }
      }
      needsUrl.push(name);
    }),
  );

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
      const { url } = (await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: `  Logo URL for "${name}":`,
        },
      ])) as { url: string };

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
          console.log(`${c.warn} ${c.warning('No SVG found at that URL.')}`);
        } else {
          console.log(
            c.warn +
              ' ' +
              c.warning(
                `Found ${svgs.length} SVG(s) but none contained a usable logomark (wordmark or unrecognised).`,
              ),
          );
        }
        const { retry } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'retry',
            message: '    Try a different URL?',
            default: true,
          },
        ])) as { retry: boolean };
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
// Build a job-scoped Profile from a polished ResumeDocument
// ---------------------------------------------------------------------------

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
    // Clear fields not part of the job-specific profile
    publications: [],
  };
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
