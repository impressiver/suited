import chalk from 'chalk';

export const c = {
  // Icons
  ok:   chalk.green('✓'),
  warn: chalk.yellow('⚠'),
  fail: chalk.red('✗'),
  arr:  chalk.dim('→'),

  // Text styles
  header:  (s: string) => chalk.bold.cyan(s),
  step:    (s: string) => chalk.bold(s),
  success: (s: string) => chalk.green(s),
  warning: (s: string) => chalk.yellow(s),
  error:   (s: string) => chalk.red(s),
  label:   (s: string) => chalk.dim(s),
  value:   (s: string) => chalk.white.bold(s),
  muted:   (s: string) => chalk.dim(s),
  path:    (s: string) => chalk.cyan(s),
  tip:     (s: string) => chalk.dim.italic(s),

  // Diff
  added:   (s: string) => chalk.green(s),
  removed: (s: string) => chalk.red(s),
};
