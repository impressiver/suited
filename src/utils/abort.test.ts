import { describe, expect, it } from 'vitest';
import { throwIfAborted } from './abort.ts';

describe('throwIfAborted', () => {
  it('no-ops when signal is undefined', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it('throws AbortError when aborted', () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfAborted(ac.signal)).toThrowError(/aborted/i);
  });
});
