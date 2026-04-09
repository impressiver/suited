import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { AppStoreProvider } from '../../store.tsx';
import { ConfirmPrompt } from './ConfirmPrompt.tsx';

describe('ConfirmPrompt', () => {
  it('renders message and hint', () => {
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp/suited-confirm-test">
        <ConfirmPrompt message="Delete?" active={false} onConfirm={() => {}} onCancel={() => {}} />
      </AppStoreProvider>,
    );
    expect(out).toContain('Delete?');
    expect(out).toContain('yes');
  });
});
