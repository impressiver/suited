import chalk from 'chalk';

/**
 * Minimal TTY-safe spinner. Falls back to plain text when not in a terminal.
 */
export function createSpinner(text: string) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${text}\n`);
    return {
      stop: () => {},
      succeed: (msg?: string) => {
        if (msg) console.log(msg);
      },
    };
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const width = text.length + 3;
  const interval = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${chalk.dim(text)}`);
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(width)}\r`);
    },
    succeed: (msg?: string) => {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(width)}\r`);
      if (msg) console.log(msg);
    },
  };
}
