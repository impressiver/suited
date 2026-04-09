import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { ProgressSteps } from './ProgressSteps.tsx';

describe('ProgressSteps', () => {
  it('marks current step', () => {
    const out = renderToString(
      <ProgressSteps steps={['Import', 'Refine', 'Generate']} currentIndex={1} />,
    );
    expect(out).toContain('Refine');
    expect(out).toContain('●');
  });
});
