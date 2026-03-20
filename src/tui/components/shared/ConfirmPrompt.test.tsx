import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { ConfirmPrompt } from './ConfirmPrompt.tsx';

describe('ConfirmPrompt', () => {
  it('renders message and hint', () => {
    const out = renderToString(
      <ConfirmPrompt message="Delete?" active={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain('Delete?');
    expect(out).toContain('yes');
  });
});
