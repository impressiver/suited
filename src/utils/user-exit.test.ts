import { describe, expect, it } from 'vitest';
import { isUserExit } from './user-exit.js';

describe('isUserExit', () => {
  it('returns false for non-Error values', () => {
    expect(isUserExit(null)).toBe(false);
    expect(isUserExit('oops')).toBe(false);
  });

  it('detects ExitPromptError by constructor name', () => {
    class ExitPromptError extends Error {
      override name = 'ExitPromptError';
    }
    expect(isUserExit(new ExitPromptError('closed'))).toBe(true);
  });

  it('detects force-closed message', () => {
    expect(isUserExit(new Error('User force closed the prompt'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isUserExit(new Error('ENOENT'))).toBe(false);
  });
});
