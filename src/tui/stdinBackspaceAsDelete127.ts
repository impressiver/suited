/**
 * Ink's `parse-keypress` maps Unicode DEL (0x7f) and Kitty CSI-u codepoint 127 to `key.delete`.
 * Most macOS / xterm setups send 0x7f for the **Backspace** key; true forward delete is usually
 * `ESC [ 3 ~` (parsed separately). We use raw stdin chunks to recover backspace semantics.
 */
export function terminalChunkIsBackspaceAs127(chunk: Buffer): boolean {
  if (chunk.length === 1 && chunk[0] === 0x7f) {
    return true;
  }
  const s = chunk.toString('binary');
  if (s === '\x1b\x7f') {
    return true;
  }
  // Kitty keyboard protocol: CSI [127;modifiers…] u
  const esc = '\u001b';
  return new RegExp(`^${esc}\\[127(?:;[\\d:]*)?u$`).test(s);
}
