/**
 * Default entry point: runs when `resume` is invoked without a subcommand.
 * Delegates to the dashboard for context-aware navigation.
 */

import { runDashboard } from './dashboard.js';

export interface FlowOptions {
  profileDir?: string;
  headed?: boolean;
  clearSession?: boolean;
}

export async function runFlow(options: FlowOptions): Promise<void> {
  await runDashboard(options);
}
