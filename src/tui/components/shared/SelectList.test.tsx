import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { SelectList } from './SelectList.tsx';

describe('SelectList', () => {
  it('shows a caret only when the list is active', () => {
    const items = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    const inactive = renderToString(
      <SelectList items={items} selectedIndex={0} onChange={() => {}} isActive={false} />,
    );
    expect(inactive).toContain('Alpha');
    expect(inactive.includes('›')).toBe(false);

    const active = renderToString(
      <SelectList items={items} selectedIndex={0} onChange={() => {}} isActive />,
    );
    expect(active.includes('›')).toBe(true);
  });
});
