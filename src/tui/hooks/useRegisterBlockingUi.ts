import { useEffect } from 'react';
import { useAppDispatch } from '../store.tsx';

/**
 * While `active`, global `q` / screen jumps are suppressed via `blockingUiDepth` in the store.
 */
export function useRegisterBlockingUi(active: boolean): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!active) {
      return;
    }
    dispatch({ type: 'INCREMENT_BLOCKING_UI' });
    return () => dispatch({ type: 'DECREMENT_BLOCKING_UI' });
  }, [active, dispatch]);
}
