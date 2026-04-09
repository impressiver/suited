import figlet from 'figlet';
import ColossalFont from 'figlet/importable-fonts/Colossal.js';

/**
 * Renders "Suited" as fancy ANSI block text with shadow.
 * Uses the Colossal figlet font for a bold, elegant look.
 */
export function generateSuitedLogo(): string {
  try {
    figlet.parseFont('Colossal', ColossalFont);
    const raw = figlet.textSync('SUITED', { font: 'Colossal' });
    const lines = raw.split('\n');
    // Trim blank lines top and bottom
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  } catch {
    return 'SUITED';
  }
}

/**
 * Renders "Suited" as a compact but fancy ANSI logo suitable for a header.
 * Uses block characters and shadow effects.
 */
export function generateCompactSuitedLogo(): string {
  // Compact but elegant block-style logo
  const lines = [
    '███████╗██╗   ██╗██╗████████╗███████╗██████╗ ',
    '██╔════╝██║   ██║██║╚══██╔══╝██╔════╝██╔══██╗',
    '███████╗██║   ██║██║   ██║   █████╗  ██║  ██║',
    '╚════██║██║   ██║██║   ██║   ██╔══╝  ██║  ██║',
    '███████║╚██████╔╝██║   ██║   ███████╗██████╔╝',
    '╚══════╝ ╚═════╝ ╚═╝   ╚═╝   ╚══════╝╚═════╝ ',
  ];
  return lines.join('\n');
}

/**
 * Renders "Suited" with a 3D shadow effect using block characters.
 */
export function generateShadowSuitedLogo(): string {
  // 3D shadow effect using block characters
  const lines = [
    '░███████╗░██╗░░░██╗░██╗░████████╗░███████╗░██████╗░',
    '░██╔════╝░██║░░░██║░██║░╚══██╔══╝░██╔════╝░██╔══██╗',
    '░███████╗░██║░░░██║░██║░░░░██║░░░░█████╗░░░██║░░██║',
    '░╚════██║░██║░░░██║░██║░░░░██║░░░░██╔══╝░░░██║░░██║',
    '░███████║░╚██████╔╝░██║░░░░██║░░░░███████╗░██████╔╝',
    '░╚══════╝░░╚═════╝░░╚═╝░░░░╚═╝░░░░╚══════╝░╚═════╝░',
  ];
  return lines.join('\n');
}
