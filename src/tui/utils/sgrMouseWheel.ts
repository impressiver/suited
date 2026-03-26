/**
 * xterm SGR mouse protocol (CSI `<` … `M` / `m`).
 * Wheel, cell clicks, and drags (with CSI ?1002 button-motion tracking).
 *
 * Ink's `useInput` strips one leading ESC from `input`, so events often arrive as `[<65;92;14M`.
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Extended-coordinates
 */

const ESC = 0x1b;

export type SgrMouseParsed =
  | { kind: 'wheel'; delta: number }
  | {
      kind: 'pointer';
      /** 0-based terminal cell X (after subtracting 1 from the wire format). */
      px: number;
      /** 0-based terminal cell Y. */
      py: number;
      released: boolean;
      leftPress: boolean;
      leftDrag: boolean;
    }
  /** Middle/right button, unknown codes — swallow, do not insert as text. */
  | { kind: 'other' };

function normalizeSgrMouseInput(input: string): string | null {
  if (input.length < 8) {
    return null;
  }
  if (input.codePointAt(0) === ESC && input[1] === '[' && input[2] === '<') {
    return input;
  }
  if (input[0] === '[' && input[1] === '<') {
    return `${String.fromCodePoint(ESC)}${input}`;
  }
  return null;
}

/**
 * If this string is an SGR mouse report, return how to handle it.
 * Returns `null` when the input is not a complete SGR mouse sequence.
 */
export function parseSgrMouseEvent(input: string): SgrMouseParsed | null {
  const s = normalizeSgrMouseInput(input);
  if (s === null) {
    return null;
  }
  const phase = s[s.length - 1];
  if (phase !== 'M' && phase !== 'm') {
    return null;
  }
  const inner = s.slice(3, -1);
  const parts = inner.split(';');
  if (parts.length !== 3) {
    return null;
  }
  if (!parts.every((p) => /^\d+$/.test(p))) {
    return null;
  }
  const btn = Number.parseInt(parts[0] ?? '', 10);
  const px1 = Number.parseInt(parts[1] ?? '', 10);
  const py1 = Number.parseInt(parts[2] ?? '', 10);
  if (Number.isNaN(btn) || Number.isNaN(px1) || Number.isNaN(py1)) {
    return null;
  }
  const px = px1 - 1;
  const py = py1 - 1;

  if (phase === 'm') {
    return {
      kind: 'pointer',
      px,
      py,
      released: true,
      leftPress: false,
      leftDrag: false,
    };
  }

  const step = 3;
  if (btn === 64) {
    return { kind: 'wheel', delta: -step };
  }
  if (btn === 65) {
    return { kind: 'wheel', delta: step };
  }
  if (btn === 66) {
    return { kind: 'wheel', delta: -step };
  }
  if (btn === 67) {
    return { kind: 'wheel', delta: step };
  }

  const motion = (btn & 32) !== 0;
  const low = btn & 3;
  if (low !== 0) {
    return { kind: 'other' };
  }

  if (motion) {
    return {
      kind: 'pointer',
      px,
      py,
      released: false,
      leftPress: false,
      leftDrag: true,
    };
  }
  return {
    kind: 'pointer',
    px,
    py,
    released: false,
    leftPress: true,
    leftDrag: false,
  };
}

/** Positive delta = scroll down (show lower content). */
export function sgrMouseWheelLinesDelta(input: string): number | null {
  const ev = parseSgrMouseEvent(input);
  return ev?.kind === 'wheel' ? ev.delta : null;
}
