export interface SuggestedNextInput {
  hasApiKey: boolean;
  hasSource: boolean;
  hasRefined: boolean;
}

export function suggestedNextLine(input: SuggestedNextInput): string {
  if (!input.hasApiKey) {
    return 'Configure API key (Settings or ANTHROPIC_API_KEY / OPENROUTER_API_KEY in env)';
  }
  if (!input.hasSource) {
    return 'Import profile source';
  }
  if (!input.hasRefined) {
    return 'Run refine on your profile';
  }
  return 'Generate for a job or manage saved jobs';
}
