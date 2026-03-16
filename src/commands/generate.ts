import { join } from 'path';
import { readFile } from 'fs/promises';
import { loadProfile } from '../profile/serializer.js';
import { markdownToProfile } from '../profile/markdown.js';
import { saveProfile } from '../profile/serializer.js';
import { analyzeJobDescription } from '../generate/job-analyzer.js';
import { curateForJob } from '../generate/curator.js';
import {
  assembleResumeDocument, selectTemplate, getRecommendedFlair, getFlairInfo,
} from '../generate/resume-builder.js';
import { renderResumeHtml } from '../generate/renderer.js';
import { exportToPdf } from '../pdf/exporter.js';
import { fileExists } from '../utils/fs.js';
import { openInEditor } from '../utils/interactive.js';
import type { FlairLevel, IndustryVertical } from '../profile/schema.js';

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

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  const profileDir = options.profileDir ?? join(process.cwd(), 'output');
  const profileJson = join(profileDir, 'profile.json');
  const profileMd = join(profileDir, 'profile.md');
  const resumesDir = options.output ?? join(profileDir, 'resumes');

  if (!(await fileExists(profileJson))) {
    throw new Error(`profile.json not found at ${profileJson}. Run 'resume import' first.`);
  }
  if (!(await fileExists(profileMd))) {
    throw new Error(`profile.md not found at ${profileMd}. Run 'resume import' first.`);
  }

  let profile = await loadProfile(profileJson);
  console.log(`\n✓ Loaded profile: ${profile.contact.name.value}`);
  console.log(`  ${profile.positions.length} positions · ${profile.skills.length} skills · ${profile.education.length} education entries`);

  let continueLoop = true;

  while (continueLoop) {
    // Step 2: Get job description
    let jdText = options.jd;
    if (!jdText) {
      const jdAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'jdSource',
          message: 'How would you like to provide the job description?',
          choices: [
            { name: 'Paste text', value: 'paste' },
            { name: 'File path', value: 'file' },
          ],
        },
      ]);

      if ((jdAnswer as { jdSource: string }).jdSource === 'paste') {
        const pasteAnswer = await inquirer.prompt([
          {
            type: 'editor',
            name: 'jd',
            message: 'Paste the job description (save and close editor when done):',
          },
        ]);
        jdText = (pasteAnswer as { jd: string }).jd;
      } else {
        const fileAnswer = await inquirer.prompt([
          { type: 'input', name: 'filePath', message: 'Path to job description file:' },
        ]);
        jdText = await readFile((fileAnswer as { filePath: string }).filePath, 'utf-8');
      }
    }

    // Step 3: Analyze JD
    console.log('\nAnalyzing job description...');
    let jobAnalysis = await analyzeJobDescription(jdText);

    console.log('\nJob Analysis:');
    console.log(`  Company:    ${jobAnalysis.company}`);
    console.log(`  Title:      ${jobAnalysis.title}`);
    console.log(`  Industry:   ${INDUSTRY_LABELS[jobAnalysis.industry]}`);
    console.log(`  Seniority:  ${jobAnalysis.seniority}`);
    console.log(`  Key Skills: ${jobAnalysis.keySkills.slice(0, 6).join(', ')}`);

    const confirmAnalysis = await inquirer.prompt([
      { type: 'confirm', name: 'ok', message: 'Does this analysis look correct?', default: true },
    ]);

    if (!(confirmAnalysis as { ok: boolean }).ok) {
      const overrides = await inquirer.prompt([
        { type: 'input', name: 'company', message: 'Company name:', default: jobAnalysis.company },
        { type: 'input', name: 'title', message: 'Job title:', default: jobAnalysis.title },
        {
          type: 'list',
          name: 'industry',
          message: 'Industry:',
          choices: Object.entries(INDUSTRY_LABELS).map(([v, n]) => ({ value: v, name: n })),
          default: jobAnalysis.industry,
        },
      ]);
      jobAnalysis = { ...jobAnalysis, ...(overrides as Partial<typeof jobAnalysis>) };
    }

    // Step 4: Flair selection
    const recommendedFlair = getRecommendedFlair(jobAnalysis.industry);
    let requestedFlair: FlairLevel = options.flair
      ? (parseInt(options.flair, 10) as FlairLevel)
      : recommendedFlair;

    if (!options.flair) {
      const flairAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'flair',
          message: `Select flair level (recommended: ${recommendedFlair} for ${jobAnalysis.industry}):`,
          choices: [
            { value: 1, name: '1 — Classic (ATS-safe, serif, no color)' },
            { value: 2, name: '2 — Classic+ (clean, minimal accents)' },
            { value: 3, name: '3 — Modern (accent color, sans-serif)' },
            { value: 4, name: '4 — Modern+ (bolder accents, pill skills)' },
            { value: 5, name: '5 — Bold (full sidebar, color block)' },
          ],
          default: recommendedFlair,
        },
      ]);
      requestedFlair = (flairAnswer as { flair: FlairLevel }).flair;
    }

    // Show the effective template — warn and confirm if override happens
    const { effectiveFlair, effectiveTemplate, warning } = getFlairInfo(requestedFlair, jobAnalysis.industry);
    if (warning) {
      console.log(`\n⚠  ${warning}`);
      const confirmOverride = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: `Proceed with classic template (flair ${effectiveFlair})?`,
          default: true,
        },
      ]);
      if (!(confirmOverride as { proceed: boolean }).proceed) {
        // Let them pick again
        options.flair = undefined;
        continue;
      }
    }
    console.log(`  Template: ${effectiveTemplate} (flair ${effectiveFlair})`);

    // Step 5: Curate
    console.log('\nCurating resume with Claude...');
    let curatorResult;
    try {
      curatorResult = await curateForJob(profile, jobAnalysis);
    } catch (err) {
      console.error(`\n✗ Curation failed: ${(err as Error).message}`);
      const retry = await inquirer.prompt([
        { type: 'confirm', name: 'retry', message: 'Retry curation?', default: true },
      ]);
      if ((retry as { retry: boolean }).retry) continue;
      break;
    }

    const { plan } = curatorResult;

    // Step 5b: Show curation summary
    console.log('\nCuration Summary:');
    console.log(`  Positions: ${plan.selectedPositions.length}`);
    for (const selPos of plan.selectedPositions) {
      const pos = profile.positions.find(p => p.id === selPos.positionId);
      console.log(`    • ${pos?.title.value} @ ${pos?.company.value} (${selPos.bulletRefs.length} bullets)`);
    }
    console.log(`  Skills:    ${plan.selectedSkillIds.length}`);
    console.log(`  Projects:  ${plan.selectedProjectIds.length}`);
    console.log(`  Education: ${plan.selectedEducationIds.length}`);
    console.log(`  Certs:     ${plan.selectedCertificationIds.length}`);
    if (plan.summaryRef) console.log(`  Summary:   included`);

    const confirmCuration = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { value: 'generate', name: '✓ Generate PDF' },
          { value: 'edit', name: '✎ Edit profile.md and re-curate' },
          { value: 'retry', name: '↻ Re-run curation' },
          { value: 'cancel', name: '✗ Cancel' },
        ],
      },
    ]);

    const action = (confirmCuration as { action: string }).action;
    if (action === 'cancel') break;

    if (action === 'edit') {
      await openInEditor(profileMd);
      const originalProfile = await loadProfile(profileJson);
      profile = await markdownToProfile(profileMd, originalProfile);
      await saveProfile(profile, profileJson);
      console.log('Profile reloaded from markdown.');
      continue;
    }

    if (action === 'retry') continue;

    // Step 6: Build + render + export
    console.log('\n✓ Accuracy check passed');
    console.log('Assembling resume document...');
    const resumeDoc = assembleResumeDocument(
      profile,
      plan,
      curatorResult.refMap,
      effectiveFlair,
      jobAnalysis.industry,
      jobAnalysis.title,
      jobAnalysis.company,
    );

    console.log('Rendering HTML...');
    const html = await renderResumeHtml(resumeDoc);

    const safeName = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${safeName(jobAnalysis.company)}-${safeName(jobAnalysis.title)}-${date}.pdf`;
    const outputPath = join(resumesDir, filename);

    console.log('Generating PDF...');
    await exportToPdf(html, { template: effectiveTemplate, outputPath });

    console.log(`\n✓ Resume generated: ${outputPath}`);

    const postAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'next',
        message: 'What next?',
        choices: [
          { value: 'done', name: 'Done' },
          { value: 'flair', name: 'Try different flair level' },
          { value: 'newjd', name: 'Generate for a different job' },
          { value: 'edit', name: 'Edit profile and regenerate' },
        ],
      },
    ]);

    const next = (postAnswer as { next: string }).next;
    if (next === 'done') { continueLoop = false; }
    else if (next === 'flair') { options.jd = jdText; options.flair = undefined; }
    else if (next === 'newjd') { options.jd = undefined; options.flair = undefined; }
    else if (next === 'edit') {
      await openInEditor(profileMd);
      const originalProfile = await loadProfile(profileJson);
      profile = await markdownToProfile(profileMd, originalProfile);
      await saveProfile(profile, profileJson);
      console.log('Profile reloaded from markdown.');
      options.jd = jdText;
    }
  }
}
