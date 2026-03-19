#!/usr/bin/env node
/**
 * Versioning script — bumps package.json, commits, and tags.
 *
 * Bump level is auto-detected from commits since the last tag using
 * conventional-commit keywords, with a manual override option:
 *
 *   node scripts/version.mjs              # auto-detect
 *   node scripts/version.mjs --major      # force major bump
 *   node scripts/version.mjs --minor      # force minor bump
 *   node scripts/version.mjs --patch      # force patch bump
 *   node scripts/version.mjs --dry-run    # show what would happen, no changes
 *   node scripts/version.mjs --push       # also push commit + tag after tagging
 *
 * Detection rules (first match wins, evaluated per commit):
 *   major  — message contains "BREAKING CHANGE" or subject ends with "!"
 *             before the colon (e.g. "feat!: drop Node 18")
 *   minor  — subject starts with "feat" or contains "add"/"new feature"
 *   patch  — everything else (fix, update, refactor, chore, docs, …)
 *
 * The highest level found across all commits since the last tag is used.
 * If there are no commits since the last tag the script exits with a warning.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

function bump(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ---------------------------------------------------------------------------
// Commit analysis
// ---------------------------------------------------------------------------

const MAJOR_RE = /BREAKING[\s-]CHANGE|^[^:]+!:/im;
const MINOR_RE = /^feat(?:\(.+\))?[!:]|^(add|new feature)\b/im;

function classifyCommit(message) {
  if (MAJOR_RE.test(message)) return 'major';
  if (MINOR_RE.test(message)) return 'minor';
  return 'patch';
}

const LEVELS = { patch: 0, minor: 1, major: 2 };

function detectBump(commits) {
  let highest = 'patch';
  for (const { message } of commits) {
    const level = classifyCommit(message);
    if (LEVELS[level] > LEVELS[highest]) highest = level;
    if (highest === 'major') break; // can't go higher
  }
  return highest;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function lastTag() {
  try {
    return run('git describe --tags --abbrev=0');
  } catch {
    return null;
  }
}

function commitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  const raw = run(`git log ${range} --format=%H%x00%s%x00%b%x03`);
  if (!raw) return [];
  return raw.split('\x03').flatMap((chunk) => {
    const [hash, subject, body] = chunk.trim().split('\x00');
    if (!hash) return [];
    return [
      {
        hash: hash.trim(),
        subject: subject?.trim() ?? '',
        body: body?.trim() ?? '',
        message: `${subject ?? ''}\n${body ?? ''}`,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const pushAfter = args.has('--push');
const forceLevel = args.has('--major')
  ? 'major'
  : args.has('--minor')
    ? 'minor'
    : args.has('--patch')
      ? 'patch'
      : null;

// Read current version
const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

// Get commits since last tag
const tag = lastTag();
const commits = commitsSince(tag);

if (commits.length === 0 && !forceLevel) {
  console.log(`No commits since ${tag ?? 'the beginning'} — nothing to version.`);
  process.exit(0);
}

// Determine bump level
const level = forceLevel ?? detectBump(commits);
const nextVersion = bump(currentVersion, level);
const nextTag = `v${nextVersion}`;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log();
console.log(`  Current version : ${currentVersion}`);
console.log(`  Last tag        : ${tag ?? '(none)'}`);
console.log(`  Commits         : ${commits.length}`);
console.log(`  Bump level      : ${level}${forceLevel ? ' (forced)' : ' (auto-detected)'}`);
console.log(`  Next version    : ${nextVersion}`);
console.log();

if (commits.length > 0) {
  console.log('  Changes:');
  for (const c of commits) {
    const mark =
      classifyCommit(c.message) === 'major'
        ? '  [major]'
        : classifyCommit(c.message) === 'minor'
          ? '  [minor]'
          : '  [patch]';
    console.log(`    ${mark}  ${c.subject}`);
  }
  console.log();
}

if (dryRun) {
  console.log('  Dry run — no changes made.');
  process.exit(0);
}

// Confirm
const answer = await ask(`  Bump to ${nextVersion} and create tag ${nextTag}? [y/N] `);
if (!answer.trim().toLowerCase().startsWith('y')) {
  console.log('  Aborted.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

// 1. Update package.json
pkg.version = nextVersion;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`  Updated package.json → ${nextVersion}`);

// 2. Commit and tag
run(`git add "${pkgPath}"`);
run(`git commit -m "chore: release ${nextVersion}"`);
run(`git tag -a "${nextTag}" -m "${nextTag}"`);
console.log(`  Created tag ${nextTag}`);

// 3. Optionally push
if (pushAfter) {
  run('git push --follow-tags', { stdio: 'inherit' });
  console.log(`  Pushed ${nextTag} — GitHub Actions will build and publish the release.`);
} else {
  console.log();
  console.log(`  To publish:  git push --follow-tags`);
}

console.log();
