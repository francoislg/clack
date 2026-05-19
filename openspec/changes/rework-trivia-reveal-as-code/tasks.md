## 1. Foundations — data types and tool context

- [x] 1.1 Add `processedAt?: number` to `TriviaQuestion` in `src/plugins/trivia/types.ts` with a doc comment ("Stamped by `process_reveal_answers` when the question's reveal has run. Absence means pending. Legacy rows are treated as pending until either back-filled or written.")
- [x] 1.2 Add `asOf?: Date` to `QueryToolContext` in `src/tools/types.ts` with a doc comment ("Effective 'now' for time-sensitive tools. Populated by `cronScheduler.executeJob` during replay. Real wall-clock `Date.now()` is used when absent.")
- [x] 1.3 Plumb `asOf` from `cronScheduler.executeDynamicJob` into the tool context built for the session (find the existing context construction site and propagate the `asOf` parameter already accepted by `executeJob`)
- [x] 1.4 **Decision**: option (a) — one-shot back-fill script that stamps `processedAt = postedAt` for existing questions. Script implementation lives in task 8.1.

## 2. Shared leaderboard helper

- [ ] 2.1 Create `src/plugins/trivia/computeLeaderboard.ts` exporting `computeLeaderboard(answers, users, options)` where `options = { sortBy: "totalCorrect" | "accuracy", limit?: number, primaryFilterSeason?: string | null }`. Extract the aggregation logic verbatim from `retrieveScores.ts` so behavior is byte-identical.
- [ ] 2.2 Refactor `retrieveScores.ts` to delegate aggregation to the new helper. The MCP tool's outer shape (Zod schema, error handling) is unchanged.
- [ ] 2.3 Update or add unit tests for the helper covering: empty answers, single-user, multi-user with tied scores, seasons-enabled with per-season + all-time aggregates, the two `sortBy` modes.
- [ ] 2.4 Verify `retrieveScores.test.ts` still passes against the refactored tool (the tool now calls the helper; behavior must not regress).

## 3. The `process_reveal_answers` MCP tool

- [ ] 3.1 Create `src/plugins/trivia/processRevealAnswers.ts` exporting `createProcessRevealAnswersTool(data, getGamesFn?)` with the Zod schema for `{ game: string, reprocessQuestionIds?: string[] }`. Wire it into `src/plugins/trivia/index.ts` with admin-tier role and a tool-mapping label ("Processing trivia reveal — {game}").
- [ ] 3.2 Implement question selection: when `reprocessQuestionIds` is absent or empty, select the oldest row in `games/<game>/questions.json` where `postedAt !== undefined && processedAt === undefined`. When non-empty, target only those IDs (validate they exist; emit per-ID errors for unknowns).
- [ ] 3.3 Implement reprocess-mode deletion: for each reprocess targetId, hard-delete every `SubmittedAnswer` row in `games/<game>/answers.json` with that questionId before re-processing.
- [ ] 3.4 Implement Slack message fetch: given a `question.messageTs`, fetch the question's Slack message via the Slack Web API (use `client.conversations.history` keyed by `oldest`/`latest` around the exact ts, or `conversations.replies` if the message is a thread parent). Capture the `reactions` array.
- [ ] 3.5 Determine the bot user ID at call time via `client.auth.test()` (mirror the pattern used elsewhere — do not hardcode).
- [ ] 3.6 Load cheats for the target questionId from `games/<game>/cheats.json` and capture the cheater user-ID set.
- [ ] 3.7 Implement voter categorization for boolean questions: from cleaned reaction lists (bot + cheaters removed), partition users into `correct`, `incorrect`, `fenceSitters` (`:+1:` AND `:-1:`), and `wildcards` (other emojis, with emoji captured per user).
- [ ] 3.8 Implement voter categorization for choice questions: from cleaned reaction lists, partition users into `correct`, `incorrect` (exactly one numbered emoji matching/not-matching `correctIndex`), silently-voided multi-react users (excluded from payload entirely), and `wildcards` (non-numbered emojis). The `fenceSitters` field is always `[]` for choice questions.
- [ ] 3.9 Persist `SubmittedAnswer` rows for every voter in `correct ∪ incorrect` (boolean) or `correct ∪ incorrect` (choice). Use the same shape as `submit_answers`: `{ userId, questionId, answer? | answerIndex?, correct, timestamp, season? }`. Stamp the current season tag when seasons are enabled.
- [ ] 3.10 Auto-register or update the global `users.json` entry for every voter (same pattern as `submit_answers`).
- [ ] 3.11 Stamp `processedAt = (ctx.asOf ?? new Date()).getTime()` on the processed question.
- [ ] 3.12 Compute `leaderboard` via the shared helper (extracted in section 2). Pass `sortBy: "totalCorrect"` and `primaryFilterSeason: <current-season-slug | null>` to match `retrieve_scores`' reveal-time call shape.
- [ ] 3.13 Compute `seasonStatus` when `seasons.enabled === true`: derive `currentSlug` and `isLastFireOfSeason` from the same logic that backs `check_season_status` (extract into a shared helper if practical). Populate `mvp` from the current-season-ordered leaderboard.
- [ ] 3.14 Implement season rollover inline: when `isLastFireOfSeason === true`, stamp `endedAt` on the closing season (idempotent), and if no future season exists with `startedAt > now`, append a continuation season (slug derived as `season-YYYY-MM` for next month, `startedAt = now`, `expectedEndAt = end-of-next-month`, `categories = global categories.json baseline`). Populate `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted` accordingly.
- [ ] 3.15 Assemble and return the `ProcessRevealResult` payload matching the spec contract. Use `textResult` / `errorResult` helpers per the pattern used by other trivia tools.

## 4. Prompt and reconcile updates

- [ ] 4.1 Delete `getProcessResponsesInstructions`, `buildSeasonsAwarePrompt`, `SEASONS_CHECK_STEP`, `SEASONS_LEADERBOARD_OVERRIDE`, and `PROCESS_RESPONSES_INSTRUCTIONS_WITH_SEASONS` from `src/plugins/trivia/scheduledPrompts.ts`. Delete `PROCESS_RESPONSES_INSTRUCTIONS`.
- [ ] 4.2 Add a new `PROCESS_REVEAL_INSTRUCTIONS` constant in `scheduledPrompts.ts` — a renderer brief (target ~30–50 lines). Must include: persona directive, "Game: {game}" header, instruction to call `process_reveal_answers(game: "{game}")`, description of the payload shape (`reveals[]`, `leaderboard`, optional `seasonStatus`), Block Kit rendering layout (header / explanation / divider / voter sections / context closer + top-level `table`), branching rule for 2-row vs 3-row leaderboard based on `seasonStatus` presence, finale-section rule based on `seasonStatus.isLastFireOfSeason`, no-timing-predictions guidance, and empty-reveals acknowledgement guidance.
- [ ] 4.3 Update `buildGameSpecs.ts`: replace `getProcessResponsesInstructions(seasonsEnabled)` with `PROCESS_REVEAL_INSTRUCTIONS`. Collapse `REVEAL_REQUIRED_TOOLS_BASE` + `REVEAL_SEASONS_TOOL` to a single constant `REVEAL_REQUIRED_TOOLS = ["mcp__trivia__process_reveal_answers"]`. Remove the `revealTools` seasons-conditional ternary.
- [ ] 4.4 Update `src/plugins/trivia/scheduledPrompts.test.ts` — rewrite assertions to match the new prompt content (mentions `process_reveal_answers`, does not mention the absorbed tools, does not branch on seasons), and remove tests that exercised the deleted constants.
- [ ] 4.5 Update `src/plugins/trivia/buildGameSpecs.test.ts` — assert reveal `requiredTools` is `["mcp__trivia__process_reveal_answers"]` regardless of `seasonsEnabled`, and that the reveal prompt is identical across seasons-on / seasons-off.

## 5. Tests for `process_reveal_answers`

- [ ] 5.1 Create `src/plugins/trivia/processRevealAnswers.test.ts` with a fixture data layer (use `testHelpers.ts` patterns).
- [ ] 5.2 Test default-mode: one pending question → returns one reveal, stamps `processedAt`, returns leaderboard, and `wasReprocessed: false`.
- [ ] 5.3 Test default-mode: multiple pending → oldest selected, others remain pending.
- [ ] 5.4 Test default-mode: no pending → returns `reveals: []`, still returns leaderboard.
- [ ] 5.5 Test default-mode: bot exclusion — bot reacts on the question; bot's userId does not appear in any voter list.
- [ ] 5.6 Test default-mode: cheater exclusion (boolean) — flagged cheater's userId does not appear in any voter list and has no `SubmittedAnswer` row written.
- [ ] 5.7 Test default-mode: voter categorization for boolean — correct / incorrect / fence-sitters / wildcards bucketed correctly with `emoji` captured for wildcards.
- [ ] 5.8 Test default-mode: voter categorization for choice — correct / incorrect / wildcards bucketed; multi-react users silently absent from payload; `fenceSitters: []`.
- [ ] 5.9 Test reprocess-mode: existing answer rows for the target questionId are hard-deleted; new rows are written reflecting current reactions; `wasReprocessed: true`.
- [ ] 5.10 Test reprocess-mode: cheater added after the original reveal is now excluded; their previously-scored answer is gone from `answers.json`.
- [ ] 5.11 Test reprocess-mode: only listed IDs are processed; unrelated pending questions remain `processedAt: undefined`.
- [ ] 5.12 Test reprocess-mode: unknown questionId yields a per-ID error in the response; known IDs in the same batch still process.
- [ ] 5.13 Test idempotency: a second default-mode call after a successful first call returns `reveals: []`; the previously-stamped `processedAt` is unchanged.
- [ ] 5.14 Test seasons: `seasonStatus` is absent when `seasons.enabled === false`.
- [ ] 5.15 Test seasons: `seasonStatus.currentSlug` and `isLastFireOfSeason` are populated correctly for mid-season and last-fire scenarios.
- [ ] 5.16 Test seasons: mid-season call does not mutate `seasons.json`; `seasonStatus.seasonClosed === false`; no `newSeasonStarted` field.
- [ ] 5.17 Test seasons: last-fire call stamps `endedAt` on the closing season; when no future season is queued, appends a continuation season; `seasonStatus.seasonClosed === true` and `seasonStatus.newSeasonStarted` references the new entry.
- [ ] 5.18 Test seasons: last-fire call with a continuation already queued stamps `endedAt` but does NOT append another entry; `seasonStatus.newSeasonStarted` is absent.
- [ ] 5.19 Test seasons: MVP is identified as the player with the highest `currentSeasonCorrect` from the computed leaderboard.
- [ ] 5.20 Test `asOf`: when `ctx.asOf` is set, `processedAt` equals `ctx.asOf.getTime()` (approximately) and the seasons computation uses `ctx.asOf` as effective "now."
- [ ] 5.21 Test admin role: the tool's registered `minRole` is `"admin"` (verify via the harvested plugin tools list).

## 6. Cron path verification

- [ ] 6.1 Verify (manually or via an integration-style test) that a reveal cron fire after the change: invokes only `process_reveal_answers` and `submit_response`; does not invoke `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, or `retrieve_scores`.
- [ ] 6.2 Run the existing `cronScheduler.test.ts` suite — verify no regression from the `asOf`-into-context plumbing change.

## 7. Cleanup and verification

- [ ] 7.1 Run `npx tsc` — verify the project type-checks with the new field, helper, tool, and context plumbing.
- [ ] 7.2 Run `npx oxlint src/` — verify the new files lint clean.
- [ ] 7.3 Run `npx oxfmt --check src/` — verify formatting is clean.
- [ ] 7.4 Run `npm test` — full suite passes.
- [ ] 7.5 Search the codebase for stale references to `getProcessResponsesInstructions`, `buildSeasonsAwarePrompt`, `SEASONS_CHECK_STEP`, `SEASONS_LEADERBOARD_OVERRIDE`, and `PROCESS_RESPONSES_INSTRUCTIONS` — delete every remaining reference.
- [ ] 7.6 Inspect the new reveal prompt's length — verify it is ~30–50 lines and does NOT enumerate any of the deterministic steps absorbed by `process_reveal_answers`.
- [ ] 7.7 Run `openspec validate rework-trivia-reveal-as-code --strict` and resolve any reported issues.

## 8. Deployment

- [ ] 8.1 (If back-fill option (a) was chosen in 1.4) Run the one-shot `processedAt = postedAt` back-fill script against the production data directory before the new code starts serving traffic.
- [ ] 8.2 Deploy. On startup, `reconcileCronJobs` updates each game's existing reveal job in place — `prompt` and `requiredTools` are overwritten while `id`, `runs[]`, `enabled`, and `lastRunAt` are preserved.
- [ ] 8.3 Verify the next scheduled reveal fire posts a correct reveal using the new flow. Confirm the cron run log shows a single `mcp__trivia__process_reveal_answers` tool invocation followed by `submit_response`.
- [ ] 8.4 Smoke-test the admin reprocess path: in a non-production game, flag a test user as a cheater on a recent question, then DM Clack to reprocess that question; verify the new reveal is correctly recomputed.
