# Implementation order

Start from a working skeleton and add screens incrementally, verifying **no Inquirer breakout** at each step (Phase B/C). Phase A may use delegation per [Phased delivery](./phased-delivery.md).

1. **Service extraction** — Extract `generateRefinementQuestions`, `applyRefinements`, `computeRefinementDiff`, `polishProfile`, `applyDirectEdit` from `commands/refine.ts` into `src/services/refine.ts`. Extract `computeHealthScore` from `commands/improve.ts`. Extract `validateProfile` from `commands/validate.ts`. Refactor the command files to delegate to services. Write unit tests. **This unblocks all TUI screens.**

2. **Infrastructure** — Install Ink + deps. Configure tsconfig JSX. Create `store.ts`, `App.tsx`, `Layout.tsx` with stub placeholder screens. Add `store.test.ts`. Verify: `suited` launches Ink; Tab and `q` work; non-TTY matches [README](./README.md#canonical-non-tty-behavior-single-source-of-truth).

3. **Shared components** — `Spinner`, `SelectList`, `TextInput`, `MultilineInput`, `ConfirmPrompt`, `StatusBadge`, `ScrollView`, `InlineEditor`, `DiffView`, `ProgressSteps`. Each gets a unit/integration test before moving on.

4. **DashboardScreen** — Reads profile files; shows all five states (no-api-key through ready). Validates `useProfile`. No async ops yet.

5. **SettingsScreen** — Minimal first: API key field + Save to .env. Enough to clear the Dashboard API banner. Polish (all fields, validation probe per [screens.md](./screens.md#settingsscreen)) follows later.

6. **ContactScreen** — Simple form. Validates save-then-reload. Full focus/Tab model.

7. **ImportScreen** — First real async op. Validates `useAsyncOp`, `ProgressSteps`, cancel-via-AbortSignal, error + retry.

8. **JobsScreen** — Two-panel + stacked. Add/delete/generate/prepare all in-screen. Validates `ConfirmPrompt`, multi-panel focus, `MultilineInput`.

9. **ProfileEditorScreen** — Local navigation stack. All sections. `InlineEditor`. Save-with-confirm on navigate-away.

10. **RefineScreen** — Largest screen. Build states in order: `not-refined` full flow first, then `already-refined` sub-menu, then each sub-flow (consultant, polish, direct-edit, prepare).

11. **GenerateScreen** — State machine. Wire all 6 steps. Curation preview + manual edit.

12. **`callWithToolStreaming`** — Add to `claude/client.ts`. Wire into Refine (questions, consultant, polish) and Generate (all steps). Add `tool_start`/`tool_end` events to clean up streaming display.

13. **AbortSignal wiring** — Pass signals from `useAsyncOp` into every long-running call. Wire Esc → cancel → footer copy.

14. **Footer polish** — Verify all mode transitions show correct footer copy. Add letter shortcuts. Optional command palette.

15. **CI enforcement** — Add [forbidden-import](./testing.md#forbidden-imports-ci-enforcement) checks for `src/tui/**`.
