## 1. Types

- [x] 1.1 Add optional `instructions?: string` and `additionalInstructions?: string` fields to `TriviaConfig` and `TriviaGame` in `src/plugins/trivia/core/configTypes.ts`, with comments matching the `theme` field's style and pointing readers at the `trivia-prompt-instructions` capability.
- [x] 1.2 Add the same two optional fields to `SeasonFormatSlot` in `src/plugins/trivia/core/configTypes.ts`.
- [x] 1.3 Add the same two optional fields to `SeasonEntry` in `src/plugins/trivia/core/types.ts`, with comments matching the `theme` field's style.

## 2. Parsers and validators

- [x] 2.1 In `src/plugins/trivia/core/configParsers/format.ts`, define and export `normalizeInstructions(raw: string): Result<string>` and `normalizeAdditionalInstructions(raw: string): Result<string>` mirroring the existing `normalizeTheme` exactly (trim, reject empty after trim).
- [x] 2.2 In the same file, define and export `triviaInstructionsZod` and `triviaAdditionalInstructionsZod` zod schemas mirroring `triviaThemeZod`.
- [x] 2.3 Extend `validateFormat` in `format.ts` to parse slot-level `instructions` and `additionalInstructions` using the lenient drop-on-invalid policy already used for `theme` at the slot level. Splice into the existing slot walker (around the slot-fields loop).
- [x] 2.4 In `src/plugins/trivia/core/configParsers/games.ts`, mirror the existing `theme` parsing block to parse `instructions` and `additionalInstructions` on each `TriviaGame` entry. Apply lenient drop-on-invalid.
- [x] 2.5 In `src/plugins/trivia/core/configBridge.ts`, extend `parseTriviaConfigObject` to parse workspace-tier `instructions` and `additionalInstructions` using the same lenient drop-on-invalid policy as the existing workspace-tier scalar fields.

## 3. Domain resolver

- [x] 3.1 Create `src/plugins/trivia/domain/instructions.ts` exporting `resolveInstructions(currentSeason, slotIndex, game, config)` (replace cascade) and `resolveAdditionalInstructions(currentSeason, slotIndex, game, config)` (cumulative cascade). Use the `[Workspace]` / `[Game]` / `[Season]` / `[Slot <index>]` tier-label format for the cumulative output, joined with `\n\n`. Return `null` when every tier is empty.
- [x] 3.2 Create `src/plugins/trivia/domain/instructions.test.ts` covering: every tier alone, every pair, all four together, empty-tier skips, whitespace-only treated as absent, slot-index label, `null` return when nothing is set.

## 4. Mutation tools (admin write surfaces)

- [x] 4.1 In `src/plugins/trivia/tools/games/setWorkspaceConfig.ts`, add `instructions: triviaInstructionsZod.nullable().optional()` and `additionalInstructions: triviaAdditionalInstructionsZod.nullable().optional()` args with null-to-clear / omit-to-keep semantics; wire into the config-file mutation.
- [x] 4.2 In `src/plugins/trivia/tools/games/upsertGame.ts`, mirror the existing `theme` arg + CREATE/UPDATE handling for both new fields. Add `hasInstructions` and `hasAdditionalInstructions` booleans to the response payload.
- [x] 4.3 In `src/plugins/trivia/tools/seasons/upsertSeason.ts`, mirror the existing `theme` arg + CREATE/UPDATE handling for both new fields, in both branches. Add `hasInstructions` and `hasAdditionalInstructions` booleans to both response payloads.
- [x] 4.4 Update each tool's `description` string to document the cascade semantics (replace vs cumulative) for the two new fields.

## 5. Read tools (admin debug surfaces)

- [x] 5.1 In `src/plugins/trivia/tools/games/listGames.ts`, surface `instructions` and `additionalInstructions` on the per-game entry under the present-iff-set rule (same as `theme`). Surface them on the workspace-level section as well.
- [x] 5.2 In `src/plugins/trivia/tools/seasons/listSeasons.ts`, surface both fields at the season tier AND on each slot via `mapSlot`, under the present-iff-set rule.

## 6. Consumer integration (resolver → tool payload)

- [x] 6.1 In `src/plugins/trivia/tools/questions/getIdeas.ts`, call both resolvers and include `instructions` / `additionalInstructions` in the response payload alongside the existing `theme` field. Use the present-iff-non-null rule (omit when resolver returns null).
- [x] 6.2 Extend the `get_ideas` tool DESCRIPTION to document both new payload fields, mirroring the existing `theme` bullet.
- [x] 6.3 In `src/plugins/trivia/tools/reveal/types.ts`, add `instructions?: string` and `additionalInstructions?: string` to `ProcessRevealResult`.
- [x] 6.4 In `src/plugins/trivia/tools/reveal/processRevealAnswers.ts`, call both resolvers and include the values on the returned `ProcessRevealResult`. For multi-question batches, the implementation may pick any deterministic strategy for slot-tier resolution — document the chosen strategy in code comments.
- [x] 6.5 Extend the `process_reveal_answers` tool DESCRIPTION to document both new payload fields.

## 7. Prompts

- [x] 7.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, extend the question-posting prompt section (the area that already references `theme` from the `get_ideas` payload) to instruct Claude to honor `instructions` and `additionalInstructions` verbatim when present, and to ignore them when absent (no fabrication, no synthesis).
- [x] 7.2 In the same file, extend `PROCESS_REVEAL_INSTRUCTIONS` (the reveal prompt) to instruct Claude to honor both fields verbatim during reveal rendering when present.

## 8. Tests (extending existing suites)

- [x] 8.1 Add round-trip tests for `instructions` / `additionalInstructions` to `src/plugins/trivia/core/configParsers/games.test.ts` covering: parses both fields, drops on whitespace-only, drops on non-string, retains other fields when one drops.
- [x] 8.2 Add tests to `src/plugins/trivia/tools/games/upsertGame.test.ts` covering CREATE + UPDATE for both fields, including null-to-clear semantics and the `hasInstructions` / `hasAdditionalInstructions` response booleans.
- [x] 8.3 Add tests to `src/plugins/trivia/tools/games/setWorkspaceConfig.test.ts` covering workspace-tier set / clear / preserve-on-omit semantics for both fields.
- [x] 8.4 Add a new test file (or extend an existing `upsertSeason.*.test.ts`) covering CREATE + UPDATE for both season-tier fields, including null-to-clear and slot-level field round-trip.
- [x] 8.5 Add tests to `src/plugins/trivia/tools/questions/getIdeas.opener.test.ts` (or a new `getIdeas.instructions.test.ts`) verifying the response payload includes the resolved values when set and omits them when absent.
- [x] 8.6 Add tests to `src/plugins/trivia/tools/reveal/processRevealAnswers.test.ts` verifying `ProcessRevealResult` carries the resolved values.
- [x] 8.7 Add tests to `src/plugins/trivia/tools/games/listGames.test.ts` and `src/plugins/trivia/tools/seasons/seasons.test.ts` (or the listSeasons test file) verifying both fields surface under the present-iff-set rule at every tier they apply to.

## 9. Verification

- [x] 9.1 Run `npx tsc` and confirm zero type errors.
- [x] 9.2 Run `npm test -- src/plugins/trivia` and confirm all suites pass.
- [x] 9.3 Run `npx oxlint src/plugins/trivia` and `npx oxfmt --check src/plugins/trivia`; fix any flagged files.
- [x] 9.4 Run `openspec validate add-trivia-instructions-axes --strict` and confirm zero issues.
- [ ] 9.5 Manual end-to-end smoke: boot `npm run dev`, use `/upsert_game` / `/upsert_season` / `/set_workspace_config` to set both axes at two different tiers, fire the question cron (or wait for it), confirm the question-generation prompt receives the resolved values in `get_ideas`'s logged response; fire the reveal cron and confirm `process_reveal_answers` returns the resolved values.
