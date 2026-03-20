import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

/** Tracks `stdout` columns/rows and updates on `resize` (SIGWINCH). */
export function useTerminalSize(): [number, number] {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(() => stdout.columns ?? FALLBACK_COLS);
  const [rows, setRows] = useState(() => stdout.rows ?? FALLBACK_ROWS);

  useEffect(() => {
    const sync = () => {
      setCols(stdout.columns ?? FALLBACK_COLS);
      setRows(stdout.rows ?? FALLBACK_ROWS);
    };
    sync();
    stdout.on('resize', sync);
    return () => {
      stdout.off('resize', sync);
    };
  }, [stdout]);

  return [cols, rows];
}
