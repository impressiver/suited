import figlet from 'figlet';

/**
 * Renders a name as ASCII block art using the Colossal figlet font,
 * then replaces each contiguous non-space run with ░ + █×(n-1)
 * to produce the amber block-char aesthetic.
 */
export function generateAsciiName(name: string): string {
  try {
    const raw = figlet.textSync(name.toUpperCase(), { font: 'Colossal' });
    const lines = raw.split('\n');
    // Trim blank lines top and bottom
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines
      .map((line: string) => line.replace(/\S+/g, (m: string) => '░' + '█'.repeat(m.length - 1)))
      .join('\n');
  } catch {
    return name.toUpperCase();
  }
}
