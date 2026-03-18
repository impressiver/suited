/**
 * Detects whether an error is a user-initiated exit (Ctrl+C / ESC in inquirer).
 * Inquirer v12 throws `ExitPromptError` on force close.
 */
export function isUserExit(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.constructor.name === 'ExitPromptError' ||
    err.message.includes('force closed') ||
    err.message.includes('User force')
  );
}
