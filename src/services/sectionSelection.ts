import type { ResumeDocument } from '../profile/schema.ts';

/**
 * Same shape as the CLI `selectSections` checkbox with every section enabled
 * (TUI generate path — no interactive trimming).
 */
export function selectAllSections(doc: ResumeDocument): {
  doc: ResumeDocument;
  selected: string[];
} {
  const selected: string[] = [];
  if (doc.summary) {
    selected.push('summary');
  }
  for (let i = 0; i < doc.positions.length; i++) {
    selected.push(`pos:${i}`);
  }
  if (doc.education.length) {
    selected.push('education');
  }
  if (doc.skills.length) {
    selected.push('skills');
  }
  if (doc.projects.length) {
    selected.push('projects');
  }
  if (doc.certifications.length) {
    selected.push('certifications');
  }
  if (doc.languages.length) {
    selected.push('languages');
  }
  if (doc.volunteer.length) {
    selected.push('volunteer');
  }
  if (doc.awards.length) {
    selected.push('awards');
  }

  const enabled = new Set(selected);

  const selectedPosIdxs = selected
    .filter((v) => v.startsWith('pos:'))
    .map((v) => parseInt(v.slice(4), 10))
    .sort((a, b) => a - b);

  const selectedPositions: ResumeDocument['positions'] = [];
  if (selectedPosIdxs.length > 0) {
    const maxIdx = Math.max(...selectedPosIdxs);
    for (let i = 0; i <= maxIdx; i++) {
      const p = doc.positions[i];
      if (p) {
        selectedPositions.push(p);
      }
    }
  }

  return {
    doc: {
      ...doc,
      summary: enabled.has('summary') ? doc.summary : undefined,
      positions: selectedPositions,
      education: enabled.has('education') ? doc.education : [],
      skills: enabled.has('skills') ? doc.skills : [],
      projects: enabled.has('projects') ? doc.projects : [],
      certifications: enabled.has('certifications') ? doc.certifications : [],
      languages: enabled.has('languages') ? doc.languages : [],
      volunteer: enabled.has('volunteer') ? doc.volunteer : [],
      awards: enabled.has('awards') ? doc.awards : [],
    },
    selected,
  };
}
