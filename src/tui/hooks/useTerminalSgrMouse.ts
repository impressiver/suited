import { useStdout } from 'ink';
import { useEffect } from 'react';

/**
 * Enables SGR + “basic” mouse reporting so wheel events reach stdin as CSI sequences.
 * No-op when stdout is not a TTY.
 */
export function useTerminalSgrMouse(enable: boolean): void {
  const { stdout } = useStdout();
  useEffect(() => {
    if (!enable || !stdout.isTTY) {
      return;
    }
    // 1016 = SGR pixel coordinates; disable so 1006 reports character cells (fixes drift in
    // terminals that leave pixel mode on). Order: turn pixel mode off, then enable cell SGR.
    stdout.write('\u001b[?1016l\u001b[?1000h\u001b[?1002h\u001b[?1006h');
    return () => {
      stdout.write('\u001b[?1006l\u001b[?1002l\u001b[?1000l');
    };
  }, [enable, stdout]);
}
