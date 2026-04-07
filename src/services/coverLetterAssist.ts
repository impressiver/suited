import { callWithToolStreaming } from '../claude/client.ts';
import {
  buildCoverLetterAssistUserMessage,
  COVER_LETTER_LIGHT_REFINE_SYSTEM,
  COVER_LETTER_SNIFF_SYSTEM,
  coverLetterMarkdownTool,
} from '../claude/prompts/cover-letter.ts';

export interface CoverLetterMarkdownResult {
  markdown: string;
}

export type CoverLetterAssistYield =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; result: string };

/**
 * Light refine: grammar, clarity, structure. Label for logging: cover-letter-light-refine.
 */
export async function* lightRefineCoverLetter(
  draft: string,
  ctx: { company?: string; jobTitle?: string; jdExcerpt?: string },
  signal?: AbortSignal,
): AsyncGenerator<CoverLetterAssistYield> {
  const trimmed = draft.trim();
  if (!trimmed) {
    yield { type: 'done', result: '' };
    return;
  }
  const userMessage = buildCoverLetterAssistUserMessage(draft, ctx);
  const gen = callWithToolStreaming<CoverLetterMarkdownResult>(
    COVER_LETTER_LIGHT_REFINE_SYSTEM,
    userMessage,
    coverLetterMarkdownTool,
    undefined,
    signal,
  );
  let last: CoverLetterMarkdownResult | undefined;
  for await (const ev of gen) {
    if (ev.type === 'done') {
      last = ev.result;
    } else {
      yield ev;
    }
  }
  if (!last?.markdown?.trim()) {
    throw new Error('cover-letter-light-refine: no result from model');
  }
  yield { type: 'done', result: last.markdown.trim() };
}

/**
 * AI sniff pass: reduce machine-like phrasing. Label: cover-letter-sniff.
 */
export async function* sniffCoverLetter(
  draft: string,
  ctx: { company?: string; jobTitle?: string; jdExcerpt?: string },
  signal?: AbortSignal,
): AsyncGenerator<CoverLetterAssistYield> {
  const trimmed = draft.trim();
  if (!trimmed) {
    yield { type: 'done', result: '' };
    return;
  }
  const userMessage = buildCoverLetterAssistUserMessage(draft, ctx);
  const gen = callWithToolStreaming<CoverLetterMarkdownResult>(
    COVER_LETTER_SNIFF_SYSTEM,
    userMessage,
    coverLetterMarkdownTool,
    undefined,
    signal,
  );
  let last: CoverLetterMarkdownResult | undefined;
  for await (const ev of gen) {
    if (ev.type === 'done') {
      last = ev.result;
    } else {
      yield ev;
    }
  }
  if (!last?.markdown?.trim()) {
    throw new Error('cover-letter-sniff: no result from model');
  }
  yield { type: 'done', result: last.markdown.trim() };
}
