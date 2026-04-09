import { describe, expect, it } from 'vitest';
import { terminalChunkIsBackspaceAs127 } from './stdinBackspaceAsDelete127.ts';

describe('terminalChunkIsBackspaceAs127', () => {
  it('detects single DEL (Backspace on many terminals)', () => {
    expect(terminalChunkIsBackspaceAs127(Buffer.from([0x7f]))).toBe(true);
  });

  it('does not treat Ctrl+H / ASCII BS as this path (Ink uses key.backspace)', () => {
    expect(terminalChunkIsBackspaceAs127(Buffer.from([8]))).toBe(false);
  });

  it('does not treat forward-delete CSI as backspace', () => {
    expect(terminalChunkIsBackspaceAs127(Buffer.from('\x1b[3~', 'binary'))).toBe(false);
  });

  it('detects Kitty CSI-u 127', () => {
    expect(terminalChunkIsBackspaceAs127(Buffer.from('\x1b[127u', 'binary'))).toBe(true);
    expect(terminalChunkIsBackspaceAs127(Buffer.from('\x1b[127;5u', 'binary'))).toBe(true);
  });
});
