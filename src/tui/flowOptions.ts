/** Options passed from CLI entry (`runFlow` / `runTui`) into the Ink app. */
export interface FlowOptions {
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
}
