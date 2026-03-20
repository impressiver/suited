import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { SelectList } from './SelectList.tsx';

describe('SelectList', () => {
  it('renders items with selection marker', () => {
    const items = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    const out = renderToString(
      <SelectList items={items} selectedIndex={0} onChange={() => {}} isActive={false} />,
    );
    expect(out).toContain('Alpha');
    expect(out).toContain('›');
  });
});
