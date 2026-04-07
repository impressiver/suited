import { createContext, useContext, useState } from 'react';

export interface ValidationState {
  /** null = not checked yet, number = valid with this many anchors */
  valid: boolean | null;
  /** Error message if validation failed */
  error: string | null;
}

interface ValidationContextValue {
  state: ValidationState;
  setState: (state: ValidationState) => void;
}

const ValidationContext = createContext<ValidationContextValue | null>(null);

export function useValidation(): ValidationContextValue {
  const ctx = useContext(ValidationContext);
  if (!ctx) {
    // Return a default no-op context if not wrapped
    return {
      state: { valid: null, error: null },
      setState: () => {},
    };
  }
  return ctx;
}

export function useValidationState(): [ValidationState, (state: ValidationState) => void] {
  const ctx = useContext(ValidationContext);
  if (!ctx) {
    return [{ valid: null, error: null }, () => {}];
  }
  return [ctx.state, ctx.setState];
}

export function ValidationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ValidationState>({ valid: null, error: null });
  return (
    <ValidationContext.Provider value={{ state, setState }}>{children}</ValidationContext.Provider>
  );
}
