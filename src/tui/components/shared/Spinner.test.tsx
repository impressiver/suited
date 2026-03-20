import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('renders a braille frame and label', () => {
    const out = renderToString(<Spinner label="Working" />);
    expect(out).toContain('Working');
    // One of the spinner glyphs
    expect(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out)).toBe(true);
  });
});
