import type { CurationPlan, Profile } from '../profile/schema.ts';

/**
 * Plain-text lines for TUI (parity with CLI `prepare` curation preview).
 */
export function formatCurationPreviewLines(
  profile: Profile,
  plan: CurationPlan,
  company: string,
  title: string,
): string[] {
  const lines: string[] = [];
  lines.push(`Curated for: ${title} @ ${company}`);
  lines.push('');

  const allPositions = profile.positions;
  const totalPositions = allPositions.length;
  const selectedPositions = plan.selectedPositions.length;
  lines.push(`Experience (${selectedPositions} of ${totalPositions} selected)`);

  for (const pos of allPositions) {
    const selected = plan.selectedPositions.find((sp) => sp.positionId === pos.id);
    const start = pos.startDate.value.slice(0, 4);
    const end = pos.endDate ? pos.endDate.value.slice(0, 4) : 'Present';
    const dateRange = `${start}–${end}`;

    if (selected) {
      lines.push(`  ✓ ${pos.title.value} @ ${pos.company.value}  ${dateRange}`);
      for (const bulletRef of selected.bulletRefs) {
        const parts = bulletRef.split(':');
        if (parts.length === 3) {
          const idx = parseInt(parts[2], 10);
          const bullet = pos.bullets[idx];
          if (bullet) {
            const preview =
              bullet.value.length > 90 ? `${bullet.value.slice(0, 90)}…` : bullet.value;
            lines.push(`      · ${preview}`);
          }
        }
      }
    } else {
      lines.push(
        `  – ${pos.title.value} @ ${pos.company.value}  ${dateRange}  (excluded)`,
      );
    }
  }

  const selectedSkills = plan.selectedSkillIds
    .map((id) => profile.skills.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => s?.name.value);
  lines.push('');
  lines.push(`Skills (${selectedSkills.length})`);
  if (selectedSkills.length > 0) {
    lines.push(`  ${selectedSkills.join(', ')}`);
  }

  const selectedEdu = plan.selectedEducationIds
    .map((id) => profile.education.find((e) => e.id === id))
    .filter(Boolean);
  lines.push('');
  lines.push(`Education (${selectedEdu.length})`);
  for (const edu of selectedEdu) {
    const parts = [edu?.degree?.value, edu?.fieldOfStudy?.value].filter(Boolean);
    const label =
      parts.length > 0
        ? `${parts.join(' in ')} — ${edu?.institution.value}`
        : edu?.institution.value;
    if (label) {
      lines.push(`  ${label}`);
    }
  }

  return lines;
}
