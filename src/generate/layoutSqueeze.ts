import { measurePageFit } from '../pdf/exporter.ts';
import type { ResumeDocument } from '../profile/schema.ts';
import { buildFitOverrideCss, SQUEEZE_THRESHOLDS, type SqueezeLevel } from './fit-adjuster.ts';
import { renderResumeHtml } from './renderer.ts';

/**
 * Progressive CSS tightening before content removal (shared by CLI generate and TUI service).
 */
export async function trySqueeze(html: string, doc: ResumeDocument): Promise<string> {
  const initial = await measurePageFit(html);
  if (!initial.overflows) return html;

  const levels: SqueezeLevel[] = [1, 2, 3];
  let best = html;

  for (const level of levels) {
    if (initial.ratio < SQUEEZE_THRESHOLDS[level]) continue;

    const squeezed = await renderResumeHtml(doc, buildFitOverrideCss(level));
    const fit = await measurePageFit(squeezed);

    if (!fit.overflows) {
      return squeezed;
    }
    best = squeezed;
  }

  return best;
}
