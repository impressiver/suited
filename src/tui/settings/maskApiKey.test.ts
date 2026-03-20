import { describe, expect, it } from 'vitest';
import { maskApiKeyForDisplay } from './maskApiKey.ts';

describe('maskApiKeyForDisplay', () => {
  it('masks short keys uniformly', () => {
    expect(maskApiKeyForDisplay('short')).toBe('••••••••');
  });

  it('shows a short prefix then bullets for long keys', () => {
    const m = maskApiKeyForDisplay('sk-ant-api03-verylongsecretvaluehere');
    expect(m.startsWith('sk-ant-')).toBe(true);
    expect(m).toContain('…');
    expect(m.length).toBeGreaterThan(10);
  });
});
