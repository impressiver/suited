/** In-process scroll offset for the Dashboard resume markdown viewport, keyed by profile directory. */
const scrollByProfileDir = new Map<string, number>();

export function rememberResumeScroll(profileDir: string, scroll: number): void {
  scrollByProfileDir.set(profileDir, scroll);
}

export function readResumeScroll(profileDir: string): number | undefined {
  return scrollByProfileDir.get(profileDir);
}

export function clearResumeScroll(profileDir?: string): void {
  if (profileDir === undefined) {
    scrollByProfileDir.clear();
    return;
  }
  scrollByProfileDir.delete(profileDir);
}
