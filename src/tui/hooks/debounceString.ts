/**
 * Returns a debounced flusher; latest value wins. Used by `useDebouncedStringCallback`.
 */
export function createDebouncedString(
  fn: (value: string) => void,
  delayMs: number,
): { flush: (value: string) => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const flush = (value: string) => {
    cancel();
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      fn(value);
    }, delayMs);
  };

  return { flush, cancel };
}
