import chalk from 'chalk';

const TAGLINES = [
  'Making you look good, one bullet point at a time.',
  'Your career highlights, professionally packaged.',
  'Where LinkedIn data becomes interview gold.',
  'Land the job. Ship the resume.',
  "Because your 2009 internship shouldn't define you.",
  'Turning experience into opportunity, one PDF at a time.',
  'Polishing your career story to a mirror shine.',
  'Stand out. Get the interview. Repeat.',
];

export function randomTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}

export function banner(title: string, subtitle?: string): string {
  const titleLine = `  ✦  ${title}  ✦  `;
  const subLine = subtitle ? `  ${subtitle}  ` : '';
  const width = Math.max(titleLine.length, subLine.length);
  const pad = (s: string) => s + ' '.repeat(width - s.length);
  const rule = '─'.repeat(width + 2);

  const lines = [
    chalk.dim.cyan(`╭${rule}╮`),
    chalk.dim.cyan('│') + chalk.bold.white(` ${pad(titleLine)} `) + chalk.dim.cyan('│'),
  ];
  if (subtitle) {
    lines.push(chalk.dim.cyan('│') + chalk.italic.dim(` ${pad(subLine)} `) + chalk.dim.cyan('│'));
  }
  lines.push(chalk.dim.cyan(`╰${rule}╯`));
  return lines.join('\n');
}

export function healthStars(score: number, total = 5): string {
  const filled = chalk.yellow('★').repeat(score);
  const empty = chalk.dim('☆').repeat(total - score);
  return filled + empty;
}

const HEALTH_QUIPS: Record<number, string> = {
  5: "Perfect score. You're basically a hiring magnet.",
  4: "Looking strong — one more tweak and they don't stand a chance.",
  3: "Not bad, not great. But hey, we're getting there.",
  2: "We've got some work to do, champ. Good news: totally fixable.",
  1: "Bold of you to apply anywhere right now. Let's change that.",
  0: "Oh. Oh no. But hey — you showed up. That's step one.",
};

export function healthQuip(score: number): string {
  return chalk.italic.dim(HEALTH_QUIPS[score] ?? '');
}

export const c = {
  // Icons
  ok: chalk.green('✓'),
  warn: chalk.yellow('⚠'),
  fail: chalk.red('✗'),
  arr: chalk.dim('→'),
  star: chalk.yellow('✦'),

  // Text styles
  header: (s: string) => chalk.bold.cyan(s),
  step: (s: string) => chalk.bold(s),
  success: (s: string) => chalk.green(s),
  warning: (s: string) => chalk.yellow(s),
  error: (s: string) => chalk.red(s),
  label: (s: string) => chalk.dim(s),
  value: (s: string) => chalk.white.bold(s),
  muted: (s: string) => chalk.dim(s),
  path: (s: string) => chalk.cyan(s),
  tip: (s: string) => chalk.dim.italic(s),
  accent: (s: string) => chalk.magenta(s),
  highlight: (s: string) => chalk.yellow.bold(s),
  cheeky: (s: string) => chalk.italic.dim(s),

  // Diff
  added: (s: string) => chalk.green(s),
  removed: (s: string) => chalk.red(s),
};
