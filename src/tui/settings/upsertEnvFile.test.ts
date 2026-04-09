import { describe, expect, it } from 'vitest';
import { upsertEnvFileContents } from './upsertEnvFile.ts';

describe('upsertEnvFileContents', () => {
  it('appends new keys', () => {
    const out = upsertEnvFileContents('FOO=1\n', { ANTHROPIC_API_KEY: 'sk-x' });
    expect(out).toContain('FOO=1');
    expect(out).toContain('ANTHROPIC_API_KEY=sk-x');
  });

  it('replaces existing key', () => {
    const out = upsertEnvFileContents('ANTHROPIC_API_KEY=old\n', { ANTHROPIC_API_KEY: 'new' });
    expect(out).toContain('ANTHROPIC_API_KEY=new');
    expect(out).not.toContain('old');
  });

  it('keeps comments', () => {
    const out = upsertEnvFileContents('# hi\nX=1\n', { Y: '2' });
    expect(out).toContain('# hi');
  });
});
