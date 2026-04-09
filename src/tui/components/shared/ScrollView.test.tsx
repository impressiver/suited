import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { ScrollView } from './ScrollView.tsx';

describe('ScrollView', () => {
  it('shows a window of lines', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const out = renderToString(<ScrollView lines={lines} height={2} scrollOffset={1} />);
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).not.toContain('a');
  });

  it('wraps long logical lines when wrapWidth is set', () => {
    const lines = ['abcdefghijklmnop'];
    const out = renderToString(
      <ScrollView lines={lines} height={2} scrollOffset={0} wrapWidth={4} />,
    );
    expect(out).toContain('abcd');
    expect(out).toContain('efgh');
  });
});
