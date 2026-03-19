export type ScreenId =
  | 'dashboard'
  | 'import'
  | 'refine'
  | 'generate'
  | 'jobs'
  | 'profile'
  | 'contact'
  | 'settings';

export const SCREEN_ORDER: ScreenId[] = [
  'dashboard',
  'import',
  'refine',
  'generate',
  'jobs',
  'profile',
  'contact',
  'settings',
];

export type FocusTarget = 'sidebar' | 'content';

/** Mutable bag read by `runTui` after Ink unmounts. */
export interface TuiExitBag {
  pending: string[] | null;
  quit: boolean;
}

export const NAV_LABELS: Record<ScreenId, string> = {
  dashboard: 'Dashboard',
  import: 'Import',
  refine: 'Refine',
  generate: 'Generate',
  jobs: 'Jobs',
  profile: 'Profile',
  contact: 'Contact',
  settings: 'Settings',
};
