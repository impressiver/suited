import { useEffect, useMemo, useRef } from 'react';
import { createDebouncedString } from './debounceString.js';

/**
 * Debounced string flush — for MultilineInput (16ms) and similar.
 */
export function useDebouncedStringCallback(
  fn: (value: string) => void,
  delayMs: number,
): (value: string) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const debounced = useMemo(
    () =>
      createDebouncedString((value: string) => {
        fnRef.current(value);
      }, delayMs),
    [delayMs],
  );

  useEffect(() => () => debounced.cancel(), [debounced]);

  return debounced.flush;
}
