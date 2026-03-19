import type { FlowOptions } from '../commands/flow.js';
import type { ScreenId } from './types.js';

/** Build argv tail for `node <cli> …` subprocess (no binary name). */
export function buildPendingCliArgs(
  screen: ScreenId,
  profileDir: string,
  flow: FlowOptions,
): string[] | null {
  const base = ['--profile-dir', profileDir];
  switch (screen) {
    case 'import': {
      const a = ['import', ...base];
      if (flow.headed) {
        a.push('--headed');
      }
      if (flow.clearSession) {
        a.push('--clear-session');
      }
      return a;
    }
    case 'refine':
      return ['refine', ...base];
    case 'generate':
      return ['generate', ...base];
    case 'jobs':
      return ['jobs', ...base];
    case 'profile':
      return ['improve', ...base];
    case 'contact':
      return ['contact', ...base];
    case 'dashboard':
    case 'settings':
      return null;
    default: {
      const _exhaustive: never = screen;
      return _exhaustive;
    }
  }
}

export function screenRunsCliOnEnter(screen: ScreenId): boolean {
  return screen !== 'dashboard' && screen !== 'settings';
}
