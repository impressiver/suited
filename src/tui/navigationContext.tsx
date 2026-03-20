import { createContext, type ReactNode, useContext } from 'react';
import type { ScreenId } from './types.ts';

const NavigateContext = createContext<(screen: ScreenId) => void>(() => {});

export function NavigateProvider({
  value,
  children,
}: {
  value: (screen: ScreenId) => void;
  children: ReactNode;
}) {
  return <NavigateContext.Provider value={value}>{children}</NavigateContext.Provider>;
}

/** Navigate between TUI screens (respects Profile unsaved guard in App). */
export function useNavigateToScreen(): (screen: ScreenId) => void {
  return useContext(NavigateContext);
}
