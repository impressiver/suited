#!/usr/bin/env node
/**
 * Fail if resume templates under src/templates contain an em dash (U+2014) or common
 * HTML entities that render as one (&mdash;, &#8212;, &#x2014;).
 * Invoked from `pnpm lint` (see package.json).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.join(__dirname, '..', 'src', 'templates');

const EM_DASH = '\u2014';

/** @param {string} line */
function hitsOnLine(line) {
  /** @type {string[]} */
  const rules = [];
  if (line.includes(EM_DASH)) rules.push('U+2014 em dash character');
  if (/&mdash;/i.test(line)) rules.push('&mdash;');
  if (/&#8212;/.test(line)) rules.push('&#8212;');
  if (/&#x2014;/i.test(line)) rules.push('&#x2014;');
  return rules;
}

/** @param {string} dir */
function walkFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function main() {
  if (!fs.existsSync(TEMPLATES_ROOT)) {
    console.error(`check-templates-no-em-dash: missing directory ${TEMPLATES_ROOT}`);
    process.exitCode = 1;
    return;
  }

  const files = walkFiles(TEMPLATES_ROOT);
  let failed = false;
  const repoRoot = path.join(__dirname, '..');

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const rel = path.relative(repoRoot, file);

    lines.forEach((line, i) => {
      for (const rule of hitsOnLine(line)) {
        failed = true;
        console.error(`${rel}:${i + 1}: em dash in template (${rule})`);
        console.error(`  ${line.trimEnd()}`);
      }
    });
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main();
