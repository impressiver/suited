/** Options passed from CLI entry (`runFlow` / `runTui`) into the Ink app. */
export interface FlowOptions {
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
  /** When true, refined saves skip `refined-history/` snapshots for this process (matches CLI `--no-history-snapshot`). */
  noHistorySnapshot?: boolean;
}
