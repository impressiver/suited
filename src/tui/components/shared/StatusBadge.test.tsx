import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('renders children', () => {
    const out = renderToString(<StatusBadge tone="ok">Ready</StatusBadge>);
    expect(out).toContain('Ready');
  });
});
