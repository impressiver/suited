/**
 * Minimal key checks — no profile/resume content in the request body (per screens spec).
 */

export type ProviderId = 'anthropic' | 'openrouter';

export async function probeApiKey(
  provider: ProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ok: false, message: 'API key is empty' };
  }

  if (provider === 'anthropic') {
    return probeAnthropic(trimmed, signal);
  }
  return probeOpenRouter(trimmed, signal);
}

async function probeAnthropic(
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });

  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'Anthropic rejected this key (401/403)' };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
}

/** OpenRouter: auth probe via models list (GET, no body). */
async function probeOpenRouter(
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (res.ok) {
    return { ok: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'OpenRouter rejected this key (401/403)' };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
}
