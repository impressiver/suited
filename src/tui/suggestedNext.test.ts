import { describe, expect, it } from 'vitest';
import { suggestedNextLine } from './suggestedNext.js';

describe('suggestedNextLine', () => {
  it('asks for API key first', () => {
    expect(suggestedNextLine({ hasApiKey: false, hasSource: false, hasRefined: false })).toMatch(
      /API key|ANTHROPIC|OPENROUTER/i,
    );
  });

  it('asks for import when no source', () => {
    expect(suggestedNextLine({ hasApiKey: true, hasSource: false, hasRefined: false })).toMatch(
      /Import/i,
    );
  });

  it('asks for refine when not refined', () => {
    expect(suggestedNextLine({ hasApiKey: true, hasSource: true, hasRefined: false })).toMatch(
      /refine/i,
    );
  });

  it('suggests generate when pipeline done', () => {
    expect(suggestedNextLine({ hasApiKey: true, hasSource: true, hasRefined: true })).toMatch(
      /Generate|jobs/i,
    );
  });
});
