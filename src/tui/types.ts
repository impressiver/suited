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
  'contact',
  'jobs',
  'refine',
  'profile',
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
  profile: 'Improve',
  contact: 'Contact',
  settings: 'Settings',
};
