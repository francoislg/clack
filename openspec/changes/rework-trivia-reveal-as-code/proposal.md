## Why

The scheduled trivia reveal is a 250-line prompt that walks Claude through ~11 mechanical steps using 6 MCP tools. Most of those steps are deterministic data transformations (find the question by fuzzy keyword search, look up cheaters, categorize voters, score answers, fetch the leaderboard, decide if the season ends today) — Claude is being used as a workflow engine for work that has no creative content. The fragility is real: the keyword-based question lookup has fallback branches for "no match" and "multiple matches," the cheater-exclusion logic is enforced by repeated "INTERNAL STEP, NEVER SURFACE" guardrails, and the season-rollover path has conditional step-12 splicing in the prompt builder. The only step that genuinely needs Claude is rendering the final reveal in the Game Show Presenter voice.

Moving the deterministic work into a single MCP tool (`process_reveal_answers`) eliminates the fragility, shrinks the prompt to a renderer brief, makes admin-driven reprocessing trivial (e.g. when a cheater is flagged after the reveal), and removes ~80 lines of "must not leak" guardrails by making the unsafe data structurally absent from the renderer's input.

## What Changes

- **NEW** `process_reveal_answers` MCP tool on the trivia plugin (admin tier): takes `{ game, reprocessQuestionIds? }`, processes the oldest unprocessed question for the game (or hard-deletes + reprocesses the listed IDs), and returns a structured payload (`{ reveals, leaderboard, seasonStatus? }`) ready for the renderer.
- **NEW** `processedAt?: number` field on `TriviaQuestion` — single source of truth for "has this been revealed yet?" Replaces the current keyword-search-based reveal targeting.
- **NEW** `asOf?: Date` on `QueryToolContext`, plumbed from `cronScheduler.executeJob` — supports replay without making Claude pass it as a tool arg.
- **MODIFIED** Reveal-side scheduled prompt (`PROCESS_RESPONSES_INSTRUCTIONS`) shrinks from ~250 lines of orchestration to ~30–50 lines of rendering brief; seasons-aware splicing collapses (the payload tells the renderer everything it needs).
- **MODIFIED** Reveal cron specs (`buildGameSpecs.ts`): `requiredTools` collapses from 5–6 entries to `[mcp__trivia__process_reveal_answers]`.
- **MODIFIED** Season-end rollover (stamping `endedAt` on the closing season, creating a continuation when none is queued) moves from a Claude-driven tool sequence at the end of the reveal into the `process_reveal_answers` tool itself; the outcome is reported in the returned `seasonStatus.seasonClosed` / `newSeasonStarted` fields.
- **MODIFIED** `retrieveScores`: aggregation logic extracted into a shared `computeLeaderboard` helper so the new tool and the existing one stay in lockstep.
- **UNCHANGED** Existing tools (`submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, `check_season_status`, `fetch_channel_messages`) remain registered for ad-hoc admin queries — they leave the hot path but their semantics don't change.
- **UNCHANGED** Question-posting flow (`SEND_QUESTIONS_INSTRUCTIONS`) and its tools. The creative work stays Claude-driven.
- **UNCHANGED** Cron scheduler, plugin SDK, and cron job persistence — no new framework, no new SDK methods. The reveal-as-code shift fits inside the existing MCP-tool registration mechanism.

## Capabilities

### New Capabilities
- `trivia-reveal-processor`: defines the `process_reveal_answers` MCP tool — inputs, payload contract, idempotency rules (default = process oldest pending; reprocess = hard-delete-and-redo), silent exclusion of bot/cheaters/multi-react voters, and in-tool season rollover behavior.

### Modified Capabilities
- `trivia-scheduled-prompts`: the reveal prompt's contract changes — it becomes a renderer brief that calls one tool and renders the returned payload; reveal `requiredTools` collapses to a single entry; seasons-aware prompt splicing is removed.
- `trivia-seasons`: season-end rollover semantics move into `process_reveal_answers`. The behavior (when the closing season's `endedAt` is stamped, when a continuation is created) stays the same, but the trigger moves from "Claude calls these tools as the final step" to "the reveal processor performs them inline and reports back."
- `trivia-managed-schedules`: the reveal spec's `requiredTools` shape changes from a 5–6 tool list to a single-tool list. The reconcile mechanism is unchanged.

## Impact

- **Source files modified:**
  - `src/plugins/trivia/scheduledPrompts.ts` — `PROCESS_RESPONSES_INSTRUCTIONS` shrinks to a renderer brief; `getProcessResponsesInstructions`, `SEASONS_CHECK_STEP`, `SEASONS_LEADERBOARD_OVERRIDE`, and `buildSeasonsAwarePrompt` are removed (seasons-aware behavior is now data-driven, not prompt-spliced).
  - `src/plugins/trivia/buildGameSpecs.ts` — reveal `requiredTools` collapses; seasons-conditional tool list branching removed.
  - `src/plugins/trivia/types.ts` — `processedAt?: number` added to `TriviaQuestion`.
  - `src/plugins/trivia/retrieveScores.ts` — aggregation extracted into a shared `computeLeaderboard` helper.
  - `src/plugins/trivia/index.ts` — registers the new `process_reveal_answers` tool.
- **Source files added:**
  - `src/plugins/trivia/processRevealAnswers.ts` — the new tool implementation.
  - `src/plugins/trivia/computeLeaderboard.ts` (or inline in `retrieveScores.ts` — design decision) — shared aggregation helper.
- **Tool context surface change:**
  - `src/tools/types.ts` — `QueryToolContext` gains optional `asOf?: Date`.
  - `src/cronScheduler.ts` — passes `asOf` into the tool context during job execution.
- **Data file shape:** existing `games/<name>/questions.json` rows pick up a new optional `processedAt` field on subsequent writes. No migration needed — legacy rows without the field are treated as "never processed" by the tool's default-mode filter, which is harmless because they're also from before the reveal even ran or already had `postedAt` matched via the old keyword path. (A pragma: the tool's default mode could optionally restrict its catch-up scan to questions created after a cutoff date if back-fill becomes a concern — flagged in design.md.)
- **Tests affected:** `scheduledPrompts.test.ts`, `buildGameSpecs.test.ts`, `retrieveScores` tests, plus new tests for `process_reveal_answers` covering: default-mode oldest-pick, reprocess-mode hard-delete + re-derive, cheater exclusion, multi-react voiding (choice), season rollover (mid-season vs final-fire), asOf replay semantics.
- **Observable behavior changes for end users:** none expected. The reveal output should be visually identical when the renderer prompt is tuned correctly. The reveal becomes substantially more robust (no more "couldn't find the question by keyword" hard failures).
- **Operational change for admins:** a new supported workflow — "flag a cheater after the reveal, then ask Clack to reprocess Q123" — works cleanly via the new `reprocessQuestionIds` argument.
