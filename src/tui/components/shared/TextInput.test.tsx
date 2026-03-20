import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { AppStoreProvider } from '../../store.tsx';
import { TextInput } from './TextInput.tsx';

describe('TextInput', () => {
  it('renders under AppStoreProvider', () => {
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp">
        <TextInput value="hi" onChange={() => {}} focus={false} />
      </AppStoreProvider>,
    );
    expect(out).toContain('hi');
  });
});
