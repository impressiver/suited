import { useEffect, useMemo, useRef } from 'react';
import { createDebouncedString } from './debounceString.ts';

export interface DebouncedStringCallbacks {
  schedule: (value: string) => void;
  cancel: () => void;
}

/**
 * Debounced string flush — for MultilineInput (16ms) and similar.
 */
export function useDebouncedStringCallback(
  fn: (value: string) => void,
  delayMs: number,
): DebouncedStringCallbacks {
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

  return { schedule: debounced.flush, cancel: debounced.cancel };
}
