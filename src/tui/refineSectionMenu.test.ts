import { describe, expect, it } from 'vitest';
import { REFINE_SECTION_MENU_ROWS, refineConsultantSectionRows } from './refineSectionMenu.ts';

describe('refineSectionMenu', () => {
  it('keeps polish and consultant section rows aligned (three scoped sections)', () => {
    const consultant = refineConsultantSectionRows();
    expect(consultant).toHaveLength(3);
    expect(consultant.map((r) => r.id)).toEqual(['summary', 'experience', 'skills']);
    for (const r of consultant) {
      const polish = REFINE_SECTION_MENU_ROWS.find((x) => x.id === r.id);
      expect(polish?.polishSections).toEqual(r.polishSections);
    }
  });
});
