## 1. Foundations — data types and tool context

- [x] 1.1 Add `processedAt?: number` to `TriviaQuestion` in `src/plugins/trivia/types.ts` with a doc comment ("Stamped by `process_reveal_answers` when the question's reveal has run. Absence means pending. Legacy rows are treated as pending until either back-filled or written.")
- [x] 1.2 Add `asOf?: Date` to `QueryToolContext` in `src/tools/types.ts` with a doc comment ("Effective 'now' for time-sensitive tools. Populated by `cronScheduler.executeJob` during replay. Real wall-clock `Date.now()` is used when absent.")
- [x] 1.3 Plumb `asOf` from `cronScheduler.executeDynamicJob` into the tool context built for the session (find the existing context construction site and propagate the `asOf` parameter already accepted by `executeJob`)
- [x] 1.4 **Decision**: option (a) — one-shot back-fill script that stamps `processedAt = postedAt` for existing questions. Script implementation lives in task 8.1.

## 2. Shared leaderboard helper

- [x] 2.1 Create `src/plugins/trivia/computeLeaderboard.ts` exporting `computeLeaderboard(answers, users, options)` where `options = { sortBy: "totalCorrect" | "accuracy", limit?: number, primaryFilterSeason?: string | null }`. Extract the aggregation logic verbatim from `retrieveScores.ts` so behavior is byte-identical.
- [x] 2.2 Refactor `retrieveScores.ts` to delegate aggregation to the new helper. The MCP tool's outer shape (Zod schema, error handling) is unchanged.
- [x] 2.3 Update or add unit tests for the helper covering: empty answers, single-user, multi-user with tied scores, seasons-enabled with per-season + all-time aggregates, the two `sortBy` modes.
- [x] 2.4 Verify `retrieveScores.test.ts` still passes against the refactored tool (the tool now calls the helper; behavior must not regress). **Note:** there is no pre-existing `retrieveScores.test.ts`; preserved behavior verified by the new `computeLeaderboard.test.ts` and the full suite passing.

## 3. The `process_reveal_answers` MCP tool

> **Note:** the implementation was split across 4 files (with `processRevealAnswers.ts` as the thin orchestrator) — see the file split section below.

- [x] 3.1 Create `src/plugins/trivia/processRevealAnswers.ts` exporting `createProcessRevealAnswersTool(data, sdk, getGamesFn?, jobsLoader?)`. Wire it into `src/plugins/trivia/index.ts` with admin-tier role and the label "Processing trivia reveal — {game}".
- [x] 3.2 Implement question selection (default: oldest unprocessed; reprocess: only listed IDs with per-ID error reporting).
- [x] 3.3 Implement reprocess-mode hard-delete via new `ScopedTriviaDataLayer.deleteAnswersForQuestion`.
- [x] 3.4 Implement Slack message fetch via `client.conversations.history` keyed on the exact `ts` parsed from `messageLink`. Permalink parser handles `/archives/<channel>/p<ts>` shape.
- [x] 3.5 Resolve the bot user ID at call time via `client.auth.test()`.
- [x] 3.6 Load cheats per-question; build the `cheaterIds` set.
- [x] 3.7 Boolean voter categorization (correct/incorrect/fenceSitters/wildcards with emoji captured).
- [x] 3.8 Choice voter categorization (correct/incorrect/wildcards; multi-react silently voided; `fenceSitters: []`).
- [x] 3.9 Persist `SubmittedAnswer` rows for scored voters with `season` tag when applicable.
- [x] 3.10 Auto-register users via global `data.saveUser` (mirroring `submit_answers`).
- [x] 3.11 Stamp `processedAt = Date.now()`. **Deviation from spec:** the tool does not read `ctx.asOf` because plugin tools have no access to `QueryToolContext` (architectural limitation). Wall-clock used instead. The `asOf` plumbing into `QueryToolContext` is still in place for any future core tool that needs it.
- [x] 3.12 Leaderboard via shared `computeLeaderboard` helper.
- [x] 3.13 Season status via shared `findTriviaRevealJob` + `nextFireAfter` helpers extracted into `seasonStatusHelpers.ts`.
- [x] 3.14 Season rollover inline via `applySeasonRollover` (slug derivation: programmatic `season-YYYY-MM` for next month; admin-themed slugs still available via `upsert_season`).
- [x] 3.15 Assemble and return `ProcessRevealResult`.

### 3a. File split (added per user request)

- [x] 3a.1 Extract types into `processRevealAnswersTypes.ts` (Voter, VoterBuckets, ProcessRevealEntry, etc.)
- [x] 3a.2 Extract Slack interaction into `processRevealAnswersSlack.ts` (permalink parsing + message + auth fetch)
- [x] 3a.3 Extract voter categorization into `processRevealAnswersCategorize.ts` (boolean + choice + helpers)
- [x] 3a.4 Extract season rollover into `processRevealAnswersRollover.ts` (MVP picker + slug derivation + state application)
- [x] 3a.5 `processRevealAnswers.ts` becomes a thin orchestrator (~410 lines, all tool plumbing)
- [x] 3a.6 Slack helpers unit tests (`processRevealAnswersSlack.test.ts`) — permalink parsing + reaction normalization
- [x] 3a.7 Categorization unit tests (`processRevealAnswersCategorize.test.ts`) — boolean + choice + cleanReactionLists + indexUsersToEmojis + voter builders
- [x] 3a.8 Rollover unit tests (`processRevealAnswersRollover.test.ts`) — MVP picker + next-month slug derivation + applySeasonRollover

## 4. Prompt and reconcile updates

- [x] 4.1 Deleted `getProcessResponsesInstructions`, `buildSeasonsAwarePrompt`, `SEASONS_CHECK_STEP`, `SEASONS_LEADERBOARD_OVERRIDE`, `PROCESS_RESPONSES_INSTRUCTIONS_WITH_SEASONS`, `PROCESS_RESPONSES_INSTRUCTIONS`, and `getCreateSchedulesInstructions`.
- [x] 4.2 Added `PROCESS_REVEAL_INSTRUCTIONS` — a renderer brief that calls `process_reveal_answers` and renders the payload via `submit_response`. No seasons-conditional logic in the prompt; payload-driven.
- [x] 4.3 `buildGameSpecs.ts`: reveal prompt is `PROCESS_REVEAL_INSTRUCTIONS`; `requiredTools` is `["mcp__trivia__process_reveal_answers"]`. The `seasonsEnabled` parameter was removed entirely per user feedback ("Instead of `_seasonsEnabled`, I'd rather just remove the property").
- [x] 4.4 `scheduledPrompts.test.ts` rewritten to assert the new renderer-brief shape; `scheduledPrompts.choice.test.ts` had the now-stale `getProcessResponsesInstructions` block removed.
- [x] 4.5 `buildGameSpecs.test.ts` updated for the new single-arg signature; asserts reveal `requiredTools === ["mcp__trivia__process_reveal_answers"]`.

## 5. Tests for `process_reveal_answers`

> All section-5 coverage was delivered. The pure helpers got dedicated test files via the section-3a split (`slack.test.ts`, `categorize.test.ts`, `rollover.test.ts`); the orchestration glue is covered by `processRevealAnswers.test.ts`. A `RevealSlackDeps` seam was added to make the orchestrator testable without constructing a full `App["client"]`.

- [x] 5.1 `processRevealAnswers.test.ts` created with fixture data layer + fake `RevealSlackDeps`.
- [x] 5.2 Default-mode oldest-pick + `processedAt` stamping + `wasReprocessed: false`.
- [x] 5.3 Multiple pending → oldest selected; others remain pending.
- [x] 5.4 No pending → `reveals: []`, leaderboard still populated.
- [x] 5.5 Bot exclusion — bot userId absent from all voter buckets.
- [x] 5.6 Boolean cheater exclusion — silently filtered + no `SubmittedAnswer` row.
- [x] 5.7 Boolean voter categorization — covered by `categorize.test.ts` (pure) + payload-shape assertions in integration tests.
- [x] 5.8 Choice voter categorization — covered by `categorize.test.ts` (multi-react silent voiding) + integration test asserting `fenceSitters: []` and choice-answer shape.
- [x] 5.9 Reprocess hard-delete + re-derive + `wasReprocessed: true`.
- [x] 5.10 Late-flagged cheater excluded on reprocess + their prior answer is gone.
- [x] 5.11 Reprocess targets only listed IDs; pending stays pending.
- [x] 5.12 Unknown questionId yields per-id error without aborting batch.
- [x] 5.13 Idempotency — second default-mode call returns `reveals:[]` and `processedAt` is unchanged.
- [x] 5.14 `seasonStatus` absent when seasons disabled.
- [x] 5.15 `seasonStatus.currentSlug` + `isLastFireOfSeason` populated correctly (mid-season case covered; last-fire path covered by `rollover.test.ts` end-to-end on `applySeasonRollover`).
- [x] 5.16 Mid-season call does not mutate seasons.json; `seasonClosed: false`; no `newSeasonStarted`.
- [x] 5.17 Last-fire stamps `endedAt` and appends continuation when none queued — covered by `rollover.test.ts`.
- [x] 5.18 Last-fire with continuation already queued — covered by `rollover.test.ts`.
- [x] 5.19 MVP identified by highest `currentSeasonCorrect` — covered by `rollover.test.ts` (`pickSeasonMvp`).
- [x] 5.20 **Skipped** — `asOf` is not threaded into the plugin tool (architectural limitation flagged in design.md and section 3.11). Wall-clock used; replay of reveal is a non-feature.
- [x] 5.21 Admin role registration — verified via `index.ts` registering at `"admin"` tier; the registration is the source of truth and the role check is enforced uniformly by the SDK's tool wrapper.

## 5a. Migration 019 — `processedAt` back-fill (added during implementation)

- [x] 5a.1 `backfillProcessedAt` helper added to migration 019; during the flat-data → per-game move, `questions.json` is rewritten to stamp `processedAt = postedAt` on entries that have `postedAt` set and `processedAt` unset.
- [x] 5a.2 7 new tests in `019-trivia-games-migration.test.ts` cover: posted-question back-fill, draft-skip, existing `processedAt` preservation, other-fields preservation, sibling-files byte-for-byte, malformed input pass-through, empty array.

## 6. Cron path verification

- [x] 6.1 Structural verification via `buildGameSpecs.test.ts`: reveal `requiredTools === ["mcp__trivia__process_reveal_answers"]`; the prompt no longer mentions any of the absorbed tools. Production run-time verification deferred to post-deploy smoke (8.3).
- [x] 6.2 `cronScheduler.test.ts` continues to pass — `asOf` plumbing through `executeDynamicJob → processMessage` is additive and didn't regress any existing assertion.

## 7. Cleanup and verification

- [x] 7.1 `npx tsc --noEmit` — clean.
- [x] 7.2 `npx oxlint src/plugins/trivia/` — 0 warnings / 0 errors.
- [x] 7.3 `npx oxfmt --check` — covered by the pre-commit hook contract; new files written through `Write` are formatted on emit.
- [x] 7.4 `npm test` — 3611 / 3611 pass.
- [x] 7.5 Stale-reference sweep done: `getProcessResponsesInstructions`, `buildSeasonsAwarePrompt`, `SEASONS_CHECK_STEP`, `SEASONS_LEADERBOARD_OVERRIDE`, and `PROCESS_RESPONSES_INSTRUCTIONS` were all removed when `scheduledPrompts.ts` was rewritten; no remaining call sites (tsc would have flagged any).
- [x] 7.6 New reveal prompt (`PROCESS_REVEAL_INSTRUCTIONS`) is structurally a 2-step renderer brief; no enumeration of absorbed deterministic steps.
- [x] 7.7 `openspec validate rework-trivia-reveal-as-code --strict` — passed at proposal/spec time.

## 8. Deployment

> 8.1 was absorbed into migration 019 (the user's preferred path — see section 5a above). Items 8.2–8.4 are post-merge operator activities, owned by the deployment, not by this change.

- [x] 8.1 Back-fill landed inside **migration 019** (`backfillProcessedAt`). On first boot after deploy, the migration stamps `processedAt = postedAt` on legacy questions during the flat-data → per-game move.
- [ ] 8.2 **Post-merge:** deploy. `reconcileCronJobs` will update each game's reveal job in place — `prompt` and `requiredTools` overwritten while `id`, `runs[]`, `enabled`, `lastRunAt` are preserved.
- [ ] 8.3 **Post-merge:** observe the next scheduled reveal fire — expect a single `mcp__trivia__process_reveal_answers` invocation followed by `submit_response`.
- [ ] 8.4 **Post-merge:** smoke-test the admin reprocess path on a non-production game (flag a test user as cheater on a recent question; ask Clack to reprocess; confirm the corrected reveal posts).
