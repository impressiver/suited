import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';

export type StructuredResult<T> = T;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set. Copy .env.example to .env and add your key.');
    }
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    // 429 = rate limit, 529 = overloaded, 503 = service unavailable
    return err.status === 429 || err.status === 529 || err.status === 503;
  }
  // Network-level timeouts / connection resets
  if (err instanceof Error) {
    return err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT');
  }
  return false;
}

export async function callWithTool<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Tool,
  model = 'claude-sonnet-4-6',
): Promise<StructuredResult<T>> {
  const client = getClient();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8096,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: userMessage }],
      });

      const toolUse = response.content.find(b => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error(`Claude did not return a tool_use block`);
      }
      return toolUse.input as T;
    } catch (err: unknown) {
      const isLast = attempt === MAX_RETRIES;
      if (!isRetryable(err) || isLast) throw err;

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const status = err instanceof APIError ? ` (HTTP ${err.status})` : '';
      console.error(`Claude call failed${status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(delay);
    }
  }

  throw new Error('Unreachable');
}
