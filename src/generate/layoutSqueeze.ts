import { measurePageFit } from '../pdf/exporter.ts';
import type {
  FlairLevel,
  PinnedJobRender,
  ResumeDocument,
  TemplateName,
} from '../profile/schema.ts';
import { buildFitOverrideCss, SQUEEZE_THRESHOLDS, type SqueezeLevel } from './fit-adjuster.ts';
import { renderResumeHtml } from './renderer.ts';

export type AppliedSqueezeLevel = 0 | 1 | 2 | 3;

export interface SqueezeResult {
  html: string;
  appliedSqueezeLevel: AppliedSqueezeLevel;
}

/**
 * Progressive CSS tightening before content removal (shared by CLI generate and TUI service).
 */
export async function trySqueeze(html: string, doc: ResumeDocument): Promise<SqueezeResult> {
  const initial = await measurePageFit(html);
  if (!initial.overflows) {
    return { html, appliedSqueezeLevel: 0 };
  }

  const levels: SqueezeLevel[] = [1, 2, 3];
  let best = html;
  let bestLevel: AppliedSqueezeLevel = 0;

  for (const level of levels) {
    if (initial.ratio < SQUEEZE_THRESHOLDS[level]) continue;

    const squeezed = await renderResumeHtml(doc, buildFitOverrideCss(level));
    const fit = await measurePageFit(squeezed);

    if (!fit.overflows) {
      return { html: squeezed, appliedSqueezeLevel: level };
    }
    best = squeezed;
    bestLevel = level;
  }

  return { html: best, appliedSqueezeLevel: bestLevel };
}

export function pinnedSqueezeMatchesDoc(
  pin: PinnedJobRender,
  doc: ResumeDocument,
  requestedFlair: FlairLevel,
  templateOverride?: TemplateName,
): boolean {
  return (
    pin.requestedFlair === requestedFlair &&
    pin.templateOverride === templateOverride &&
    pin.resolvedTemplate === doc.template &&
    pin.effectiveFlair === doc.flair
  );
}

/**
 * Renders HTML and applies squeeze. When `reusePin` matches the document + flair options,
 * tries the stored squeeze tier first so repeat generates for the same job stay on the same CSS path.
 */
export async function renderWithSqueeze(
  doc: ResumeDocument,
  opts: {
    requestedFlair: FlairLevel;
    templateOverride?: TemplateName;
    reusePin?: PinnedJobRender | null;
  },
): Promise<SqueezeResult> {
  const pin = opts.reusePin;
  const pinOk =
    pin && pinnedSqueezeMatchesDoc(pin, doc, opts.requestedFlair, opts.templateOverride);

  if (pinOk) {
    const pre = await renderResumeHtml(
      doc,
      pin.squeezeLevel > 0 ? buildFitOverrideCss(pin.squeezeLevel as SqueezeLevel) : undefined,
    );
    const fit = await measurePageFit(pre);
    if (!fit.overflows) {
      return { html: pre, appliedSqueezeLevel: pin.squeezeLevel };
    }
  }

  const html = await renderResumeHtml(doc);
  return trySqueeze(html, doc);
}
