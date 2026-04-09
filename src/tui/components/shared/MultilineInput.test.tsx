import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { AppStoreProvider } from '../../store.tsx';
import { MultilineInput } from './MultilineInput.tsx';

describe('MultilineInput', () => {
  it('renders value lines under AppStoreProvider', () => {
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp">
        <MultilineInput value={'line1\nline2'} onChange={() => {}} focus={false} />
      </AppStoreProvider>,
    );
    expect(out).toContain('line1');
    expect(out).toContain('line2');
  });
});
