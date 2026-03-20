/**
 * Merge/update KEY=value lines. Preserves comments and blank lines; updates or appends known keys.
 */
export function upsertEnvFileContents(content: string, env: Record<string, string>): string {
  const keysRemaining = new Set(Object.keys(env));
  const lines = content.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (keysRemaining.has(key)) {
      out.push(`${key}=${env[key]}`);
      keysRemaining.delete(key);
    } else {
      out.push(line);
    }
  }

  for (const key of keysRemaining) {
    out.push(`${key}=${env[key]}`);
  }

  return out.join('\n').replace(/\n+$/, '') + '\n';
}
