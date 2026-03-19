import { describe, expect, it } from 'vitest';
import { detectInput } from './detector.js';

describe('detectInput', () => {
  it('detects LinkedIn profile URLs', async () => {
    const a = await detectInput('https://www.linkedin.com/in/jane-doe');
    expect(a.kind).toBe('linkedin-url');
    expect(a.value).toBe('https://www.linkedin.com/in/jane-doe');

    const b = await detectInput('linkedin.com/in/janedoe');
    expect(b.kind).toBe('linkedin-url');
  });

  it('treats non-path-looking input as pasted text', async () => {
    const r = await detectInput('Senior engineer\nPython, Go');
    expect(r.kind).toBe('paste-text');
    expect(r.value).toContain('Senior engineer');
  });

  it('treats unknown paths as pasted text when stat fails', async () => {
    const r = await detectInput('definitely-not-a-real-path-xyz123.zip');
    expect(r.kind).toBe('paste-text');
  });

  it('treats very long single-line input as paste without touching fs', async () => {
    const long = 'x'.repeat(600);
    const r = await detectInput(long);
    expect(r.kind).toBe('paste-text');
    expect(r.value).toBe(long);
  });
});
