/** True when Anthropic or OpenRouter key is present (same rule as `claude/client.ts`). */
export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

/** Per [no-color.org](https://no-color.org/): any non-empty `NO_COLOR` disables color cues that have ASCII fallbacks. */
export function shouldUseNoColor(): boolean {
  const v = process.env.NO_COLOR;
  return v !== undefined && v !== '';
}
