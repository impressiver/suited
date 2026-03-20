import { describe, expect, it } from 'vitest';
import { formatDiffBlockLines } from './DiffView.js';

describe('formatDiffBlockLines', () => {
  it('formats position bullet diff with - and + lines', () => {
    const lines = formatDiffBlockLines({
      kind: 'position-bullets',
      positionId: 'p1',
      title: 'Eng',
      company: 'Co',
      oldBullets: ['a'],
      newBullets: ['b'],
    });
    expect(lines.some((l) => l.startsWith('- a'))).toBe(true);
    expect(lines.some((l) => l.startsWith('+ b'))).toBe(true);
  });

  it('formats skills-added', () => {
    const lines = formatDiffBlockLines({
      kind: 'skills-added',
      names: ['Go', 'Rust'],
    });
    expect(lines[0]).toContain('Go');
    expect(lines[0]).toContain('Rust');
  });
});
