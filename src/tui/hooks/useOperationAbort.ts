import { useCallback, useEffect, useRef } from 'react';
import { useAppState } from '../store.tsx';

/**
 * Ties local `AbortController`s to global Esc: `CANCEL_OPERATION` bumps
 * `operationCancelSeq` in the app store, which aborts the active controller.
 */
export function useOperationAbort() {
  const { operationCancelSeq } = useAppState();
  const opAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void operationCancelSeq;
    opAbortRef.current?.abort();
  }, [operationCancelSeq]);

  const createController = useCallback(() => {
    const ac = new AbortController();
    opAbortRef.current = ac;
    return ac;
  }, []);

  const releaseController = useCallback((ac: AbortController) => {
    if (opAbortRef.current === ac) {
      opAbortRef.current = null;
    }
  }, []);

  return { createController, releaseController };
}
