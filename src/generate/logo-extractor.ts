/**
 * Uses Claude to classify an SVG logo and extract a clean logomark.
 *
 * - logomark   → return original SVG unchanged (symbol/icon only, no text)
 * - combination → Claude removes the wordmark, returns the isolated symbol
 * - wordmark   → return null (text-only, unusable as a small icon)
 * - unknown    → return null
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { callWithTool } from '../claude/client.js';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

interface ExtractionResult {
  type: 'logomark' | 'wordmark' | 'combination' | 'unknown';
  /** For combination marks only: the extracted symbol SVG with wordmark removed. */
  extractedSvg?: string;
  reasoning: string;
}

const extractionTool: Tool = {
  name: 'analyze_logo_svg',
  description: 'Classify an SVG logo and extract the logomark portion if needed.',
  input_schema: {
    type: 'object' as const,
    required: ['type', 'reasoning'],
    properties: {
      type: {
        type: 'string',
        enum: ['logomark', 'wordmark', 'combination', 'unknown'],
        description:
          'logomark = symbol/icon only (no company name); ' +
          'wordmark = company name/text only (no icon); ' +
          'combination = icon + company name together; ' +
          'unknown = cannot determine',
      },
      extractedSvg: {
        type: 'string',
        description:
          'Only for combination marks: a valid SVG containing ONLY the graphical symbol — ' +
          'all wordmark/text elements removed. Adjust the viewBox to tightly frame the ' +
          'remaining symbol. Omit for logomark, wordmark, or unknown.',
      },
      reasoning: {
        type: 'string',
        description: 'One sentence explaining the classification.',
      },
    },
  },
};

const SYSTEM = `You are a logo analyst and SVG editor.

Given SVG file content, you must:

1. Classify the logo:
   - logomark: a graphical symbol or icon with no company name text
   - wordmark: the company name in stylised text, no accompanying symbol
   - combination: a graphical symbol AND the company name/text together
   - unknown: cannot determine from the SVG content

2. For COMBINATION marks only — return extractedSvg:
   - Remove ALL text elements: <text>, <tspan>, any group that forms letter/word shapes
   - Keep ONLY the graphical symbol/icon
   - Adjust the viewBox attribute to tightly frame the retained symbol
   - The result must be a valid, self-contained <svg> element
   - Do not add comments or whitespace beyond what is needed for valid XML
   - Letter shapes converted to paths are still text — identify them by context
     (position relative to the icon, aspect ratio, repeating glyph-like structure)

3. For LOGOMARK and WORDMARK: omit extractedSvg entirely.

Return results via the analyze_logo_svg tool.`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_SVG_BYTES = 60_000;

/**
 * Classifies an SVG logo and returns a clean logomark SVG string, or null if
 * the logo is a wordmark, unrecognisable, or too large to process.
 */
export async function extractLogomark(svgContent: string): Promise<string | null> {
  if (Buffer.byteLength(svgContent, 'utf-8') > MAX_SVG_BYTES) return null;

  let result: ExtractionResult;
  try {
    result = await callWithTool<ExtractionResult>(SYSTEM, svgContent, extractionTool);
  } catch {
    return null;
  }

  if (result.type === 'logomark') {
    // Return the original SVG — don't trust Claude to not corrupt path data
    return svgContent;
  }

  if (result.type === 'combination' && result.extractedSvg?.trim()) {
    const svg = result.extractedSvg.trim();
    // Basic sanity check: must look like SVG and have some content
    if (svg.includes('<svg') && svg.length > 60) return svg;
  }

  return null;
}

/** Convert an SVG string to a base64 data URI. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
