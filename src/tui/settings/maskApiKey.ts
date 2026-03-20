/** Mask API keys for on-screen display (Settings). */
export function maskApiKeyForDisplay(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 7)}…${'•'.repeat(12)}`;
}
