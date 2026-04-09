import InkTextInput from 'ink-text-input';
import { useEffect } from 'react';
import { useAppDispatch } from '../../store.tsx';

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  /** When true, this field receives stdin (see ink-text-input `focus`). */
  focus: boolean;
  placeholder?: string;
  mask?: string;
  onSubmit?: (value: string) => void;
}

/**
 * Single-line field: wires `SET_IN_TEXT_INPUT` while focused so `App` suppresses global shortcuts.
 * Must render under `AppStoreProvider`.
 */
export function TextInput({ value, onChange, focus, placeholder, mask, onSubmit }: TextInputProps) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'SET_IN_TEXT_INPUT', value: focus });
    return () => {
      dispatch({ type: 'SET_IN_TEXT_INPUT', value: false });
    };
  }, [focus, dispatch]);

  return (
    <InkTextInput
      value={value}
      onChange={onChange}
      focus={focus}
      placeholder={placeholder}
      mask={mask}
      onSubmit={onSubmit}
    />
  );
}
