import { Text } from 'ink';
import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps {
  /** Extra label after the spinner glyph. */
  label?: string;
  /** Frame interval in ms (default 80). */
  intervalMs?: number;
}

export function Spinner({ label = '', intervalMs = 80 }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((i) => (i + 1) % FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <Text>
      {FRAMES[frame]}
      {label ? ` ${label}` : ''}
    </Text>
  );
}
