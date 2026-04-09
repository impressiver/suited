/**
 * Shared section choices for Refine **polish** (`polishProfile` `sections` arg) and
 * **section-scoped consultant** (`evaluateProfileSection` label — must stay aligned).
 */
export const REFINE_SECTION_MENU_ROWS = [
  {
    id: 'all' as const,
    polishLabel: 'Polish: summary + experience + skills',
    polishSections: ['summary', 'experience', 'skills'],
  },
  {
    id: 'summary' as const,
    polishLabel: 'Polish: summary only',
    polishSections: ['summary'],
    consultantEvaluateLabel: 'Summary',
  },
  {
    id: 'experience' as const,
    polishLabel: 'Polish: experience bullets (all roles)',
    polishSections: ['experience'],
    consultantEvaluateLabel: 'Experience',
  },
  {
    id: 'skills' as const,
    polishLabel: 'Polish: skills only',
    polishSections: ['skills'],
    consultantEvaluateLabel: 'Skills',
  },
] as const;

export type RefineSectionMenuRow = (typeof REFINE_SECTION_MENU_ROWS)[number];

export type RefineConsultantSectionRow = Extract<
  RefineSectionMenuRow,
  { consultantEvaluateLabel: string }
>;

export function refineConsultantSectionRows(): readonly RefineConsultantSectionRow[] {
  return REFINE_SECTION_MENU_ROWS.filter(
    (r): r is RefineConsultantSectionRow => 'consultantEvaluateLabel' in r,
  );
}
