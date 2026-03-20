export type ScreenId =
  | 'dashboard'
  | 'import'
  | 'refine'
  | 'generate'
  | 'jobs'
  | 'profile'
  | 'contact'
  | 'settings';

/** Sidebar order only. `profile` (manual section editor) is opened from Refine, not listed here. */
export const SCREEN_ORDER: ScreenId[] = [
  'dashboard',
  'import',
  'contact',
  'jobs',
  'refine',
  'generate',
  'settings',
];

export type FocusTarget = 'sidebar' | 'content';

export const NAV_LABELS: Record<ScreenId, string> = {
  dashboard: 'Dashboard',
  import: 'Import',
  refine: 'Refine',
  generate: 'Generate',
  jobs: 'Jobs',
  profile: 'Edit sections',
  contact: 'Contact',
  settings: 'Settings',
};
