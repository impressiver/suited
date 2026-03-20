import { describe, expect, it } from 'vitest';
import type { CurationPlan, Profile } from '../profile/schema.ts';
import { formatCurationPreviewLines } from './curationPreview.ts';

function tinyProfile(): Profile {
  const now = new Date().toISOString();
  const ue = (v: string) => ({
    value: v,
    source: { kind: 'user-edit' as const, editedAt: now },
  });
  return {
    schemaVersion: '1',
    createdAt: now,
    updatedAt: now,
    contact: { name: ue('N') },
    positions: [
      {
        id: 'pos-0',
        title: ue('Dev'),
        company: ue('Co'),
        startDate: ue('2020-01'),
        bullets: [ue('Did things')],
      },
    ],
    education: [],
    skills: [{ id: 's1', name: ue('Go') }],
    certifications: [],
    projects: [],
    publications: [],
    languages: [],
    volunteer: [],
    awards: [],
  };
}

describe('formatCurationPreviewLines', () => {
  it('includes selected position and skills', () => {
    const profile = tinyProfile();
    const plan: CurationPlan = {
      selectedPositions: [
        { positionId: 'pos-0', bulletRefs: ['b:pos-0:0'] },
      ],
      selectedSkillIds: ['s1'],
      selectedProjectIds: [],
      selectedEducationIds: [],
      selectedCertificationIds: [],
      summaryRef: null,
    };
    const lines = formatCurationPreviewLines(profile, plan, 'Acme', 'Eng');
    expect(lines.some((l) => l.includes('Curated for: Eng @ Acme'))).toBe(true);
    expect(lines.some((l) => l.includes('Dev'))).toBe(true);
    expect(lines.some((l) => l.includes('Go'))).toBe(true);
  });
});
