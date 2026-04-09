import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { AppStoreProvider } from '../../store.tsx';
import { InlineEditor } from './InlineEditor.tsx';

describe('InlineEditor', () => {
  it('shows read-only when not editing', () => {
    const out = renderToString(
      <InlineEditor value="x" onChange={() => {}} isEditing={false} inputFocused={false} />,
    );
    expect(out).toContain('x');
  });

  it('shows TextInput when editing', () => {
    const out = renderToString(
      <AppStoreProvider profileDir="/tmp">
        <InlineEditor value="edit me" onChange={() => {}} isEditing inputFocused={false} />
      </AppStoreProvider>,
    );
    expect(out).toContain('edit me');
  });
});
