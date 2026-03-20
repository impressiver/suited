import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedString } from './debounceString.js';

describe('createDebouncedString', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once with last value after delay', () => {
    const fn = vi.fn();
    const { flush } = createDebouncedString(fn, 16);
    flush('a');
    flush('b');
    flush('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel prevents flush', () => {
    const fn = vi.fn();
    const { flush, cancel } = createDebouncedString(fn, 16);
    flush('x');
    cancel();
    vi.advanceTimersByTime(16);
    expect(fn).not.toHaveBeenCalled();
  });
});
