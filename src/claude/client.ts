import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import OpenAI from 'openai';

export type StructuredResult<T> = T;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

type Backend = 'anthropic' | 'openrouter';

function getBackend(): Backend {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error('No API key found. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env');
}

let _anthropic: Anthropic | null = null;
let _openrouter: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

function getOpenRouterClient(): OpenAI {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY!,
    });
  }
  return _openrouter;
}

/** OpenRouter identifies Claude models as "anthropic/<model-name>". */
function toOpenRouterModel(model: string): string {
  return model.startsWith('anthropic/') ? model : `anthropic/${model}`;
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    // Anthropic: 429 = rate limit, 529 = overloaded, 503 = unavailable
    return err.status === 429 || err.status === 529 || err.status === 503;
  }
  if (err instanceof OpenAI.APIError) {
    // OpenRouter mirrors standard HTTP status codes
    return err.status === 429 || err.status === 503;
  }
  if (err instanceof Error) {
    return err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT');
  }
  return false;
}

function retryDelay(attempt: number, err: unknown): number {
  const base = BASE_DELAY_MS * 2 ** (attempt - 1);
  const status =
    err instanceof APIError || err instanceof OpenAI.APIError ? ` (HTTP ${err.status})` : '';
  console.error(
    `API call failed${status}, retrying in ${base}ms (attempt ${attempt}/${MAX_RETRIES})`,
  );
  return base;
}

// ---------------------------------------------------------------------------
// Anthropic backend
// ---------------------------------------------------------------------------

async function callAnthropicTool<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model: string,
): Promise<T> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 8096,
    system: systemPrompt,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a tool_use block');
  }
  return toolUse.input as T;
}

// ---------------------------------------------------------------------------
// OpenRouter backend (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callOpenRouterTool<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model: string,
): Promise<T> {
  const client = getOpenRouterClient();

  // Convert Anthropic Tool schema → OpenAI function tool
  const openAiTool: OpenAI.Chat.ChatCompletionTool = {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema as Record<string, unknown>,
    },
  };

  const response = await client.chat.completions.create({
    model: toOpenRouterModel(model),
    max_tokens: 8096,
    tools: [openAiTool],
    tool_choice: { type: 'function', function: { name: tool.name } },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== 'function') {
    throw new Error('OpenRouter did not return a function call');
  }
  return JSON.parse(call.function.arguments) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function callWithTool<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model = 'claude-sonnet-4-6',
): Promise<StructuredResult<T>> {
  const backend = getBackend();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (backend === 'openrouter') {
        return await callOpenRouterTool<T>(systemPrompt, userMessage, tool, model);
      } else {
        return await callAnthropicTool<T>(systemPrompt, userMessage, tool, model);
      }
    } catch (err: unknown) {
      const isLast = attempt === MAX_RETRIES;
      if (!isRetryable(err) || isLast) throw err;
      await sleep(retryDelay(attempt, err));
    }
  }

  throw new Error('Unreachable');
}

/**
 * Streaming-capable variant for the TUI. Today this yields a single `done` event
 * (delegates to {@link callWithTool}); Anthropic streaming + tool events can be
 * wired here without changing call sites’ result shape.
 */
export async function* callWithToolStreaming<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model = 'claude-sonnet-4-6',
): AsyncGenerator<
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; result: T }
> {
  const result = await callWithTool<T>(systemPrompt, userMessage, tool, model);
  yield { type: 'done', result };
}
