/** True when an async op was cancelled (Esc / `AbortController`). */
export function isUserAbort(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as Error).name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}
