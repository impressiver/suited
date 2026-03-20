import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { CheckboxList } from './CheckboxList.tsx';

describe('CheckboxList', () => {
  it('renders checkmarks and labels', () => {
    const out = renderToString(
      <CheckboxList
        items={[
          { value: 'a', label: 'Alpha', checked: true },
          { value: 'b', label: 'Beta', checked: false },
        ]}
        focusedIndex={0}
        onFocusChange={() => {}}
        onItemsChange={() => {}}
        onConfirm={() => {}}
        isActive={false}
      />,
    );
    expect(out).toContain('[x]');
    expect(out).toContain('[ ]');
    expect(out).toContain('Alpha');
  });

  it('shows [=] and ignores toggle for locked rows', () => {
    const out = renderToString(
      <CheckboxList
        items={[{ value: 'a', label: 'Pinned', checked: true, locked: true }]}
        focusedIndex={0}
        onFocusChange={() => {}}
        onItemsChange={() => {}}
        onConfirm={() => {}}
        isActive
      />,
    );
    expect(out).toContain('[=]');
  });
});
