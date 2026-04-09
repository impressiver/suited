#!/usr/bin/env node
/**
 * Fail if `src/tui/**` imports inquirer, ora, or anything under `src/commands/`.
 * Walks .ts/.tsx only; line-based regex (see specs/tui-testing.md).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TU_ROOT = path.join(__dirname, '..', 'src', 'tui');

/** @param {string} dir */
function walkTs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, out);
    else if (ent.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) out.push(p);
  }
  return out;
}

/** @param {string} line */
function checkLine(line) {
  /** @type {{ rule: string; detail: string }[]} */
  const hits = [];

  if (
    /from\s+['"]inquirer(?:['"`]|\/)/.test(line) ||
    /import\s*\(\s*['"]inquirer(?:['"`]|\/)/.test(line)
  ) {
    hits.push({ rule: 'inquirer', detail: 'import of package "inquirer"' });
  }

  if (/from\s+['"]ora(?:['"`]|\/)/.test(line) || /import\s*\(\s*['"]ora(?:['"`]|\/)/.test(line)) {
    hits.push({ rule: 'ora', detail: 'import of package "ora"' });
  }

  if (
    /from\s+['"](?:\.\.\/)+commands\//.test(line) ||
    /import\s*\(\s*['"](?:\.\.\/)+commands\//.test(line) ||
    /require\s*\(\s*['"](?:\.\.\/)+commands\//.test(line)
  ) {
    hits.push({
      rule: 'commands',
      detail: 'import path into src/commands/ (relative …/commands/…)',
    });
  }

  return hits;
}

function main() {
  if (!fs.existsSync(TU_ROOT)) {
    console.error(`check-tui-forbidden-imports: missing directory ${TU_ROOT}`);
    process.exitCode = 1;
    return;
  }

  const files = walkTs(TU_ROOT);
  let failed = false;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const rel = path.relative(path.join(__dirname, '..'), file);

    lines.forEach((line, i) => {
      const lineNum = i + 1;
      for (const { rule, detail } of checkLine(line)) {
        failed = true;
        console.error(`${rel}:${lineNum}: forbidden TUI import (${rule}): ${detail}`);
        console.error(`  ${line.trimEnd()}`);
      }
    });
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main();
