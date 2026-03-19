/** True when Anthropic or OpenRouter key is present (same rule as `claude/client.ts`). */
export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}
