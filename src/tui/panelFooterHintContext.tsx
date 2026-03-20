import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect } from 'react';

type SetPanelFooterHint = (hint: string | null) => void;

const PanelFooterHintSetterContext = createContext<SetPanelFooterHint | null>(null);

export function PanelFooterHintProvider({
  children,
  setHint,
}: {
  children: ReactNode;
  setHint: SetPanelFooterHint;
}) {
  return (
    <PanelFooterHintSetterContext.Provider value={setHint}>
      {children}
    </PanelFooterHintSetterContext.Provider>
  );
}

/** Pushes a contextual footer line while mounted; clears on unmount. Safe outside provider (no-op). */
export function useRegisterPanelFooterHint(hint: string) {
  const setHint = useContext(PanelFooterHintSetterContext);
  useLayoutEffect(() => {
    if (!setHint) {
      return;
    }
    setHint(hint);
  }, [setHint, hint]);
  useEffect(() => {
    if (!setHint) {
      return;
    }
    return () => setHint(null);
  }, [setHint]);
}
