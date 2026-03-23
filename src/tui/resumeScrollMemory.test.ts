import { afterEach, describe, expect, it } from 'vitest';
import { clearResumeScroll, readResumeScroll, rememberResumeScroll } from './resumeScrollMemory.ts';

describe('resumeScrollMemory', () => {
  afterEach(() => {
    clearResumeScroll();
  });

  it('remembers and reads scroll per profileDir', () => {
    rememberResumeScroll('/a', 12);
    rememberResumeScroll('/b', 30);
    expect(readResumeScroll('/a')).toBe(12);
    expect(readResumeScroll('/b')).toBe(30);
  });

  it('returns undefined when nothing stored', () => {
    expect(readResumeScroll('/none')).toBeUndefined();
  });

  it('overwrites prior value for the same profileDir', () => {
    rememberResumeScroll('/p', 5);
    rememberResumeScroll('/p', 99);
    expect(readResumeScroll('/p')).toBe(99);
  });

  it('clearResumeScroll(profileDir) removes only that key', () => {
    rememberResumeScroll('/x', 1);
    rememberResumeScroll('/y', 2);
    clearResumeScroll('/x');
    expect(readResumeScroll('/x')).toBeUndefined();
    expect(readResumeScroll('/y')).toBe(2);
  });

  it('clearResumeScroll() with no arg clears all', () => {
    rememberResumeScroll('/x', 1);
    rememberResumeScroll('/y', 2);
    clearResumeScroll();
    expect(readResumeScroll('/x')).toBeUndefined();
    expect(readResumeScroll('/y')).toBeUndefined();
  });
});
