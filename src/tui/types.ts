export type ScreenId =
  | 'dashboard'
  | 'import'
  | 'editor'
  | 'generate'
  | 'jobs'
  | 'profile'
  | 'contact'
  | 'settings';

/** Sidebar order only. `profile` (manual section editor) is opened from editor palette, not listed here. */
export const SCREEN_ORDER: ScreenId[] = [
  'dashboard',
  'import',
  'contact',
  'editor',
  'jobs',
  'generate',
  'settings',
];

/** Palette / letter / number nav pushes these as overlays; `activeScreen` stays the underlay. */
export const OVERLAY_NAV_SCREEN_IDS: ScreenId[] = ['import', 'contact', 'settings', 'generate'];

export function isOverlayNavScreen(id: ScreenId): boolean {
  return OVERLAY_NAV_SCREEN_IDS.includes(id);
}

export type FocusTarget = 'sidebar' | 'content';

export const NAV_LABELS: Record<ScreenId, string> = {
  dashboard: 'Dashboard',
  import: 'Import',
  editor: 'Editor',
  generate: 'Generate',
  jobs: 'Jobs',
  profile: 'Edit sections',
  contact: 'Contact',
  settings: 'Settings',
};
