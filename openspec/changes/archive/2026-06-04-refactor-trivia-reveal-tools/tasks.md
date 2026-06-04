## 1. Capture parity fixtures (do first — the safety net)

- [x] 1.1 Add a fixture-capture test that runs today's `process_reveal_answers` against representative game states (single boolean/choice/freeform reveal; multi-question batch; each `revealResponses` mode; nobody-correct; seasons on at mid-season; seasons on at last fire) and snapshots the resulting card blocks + the reveal `submit_response` payload + leaderboard.
- [x] 1.2 Enumerate every current call site of `process_reveal_answers` (cron prompt, any admin/management flow, tests) so none is missed by the split — resolves design.md Open Question 2.

## 2. Extract `compute_answers` (scoring, no Slack, no rollover)

- [x] 2.1 Carve the scoring/selection/payload core out of `processRevealAnswers.ts` into a `compute_answers` tool registered as `mcp__trivia__compute_answers` at `admin` tier.
- [x] 2.2 Remove the internal `editRevealIntoCard` invocation from the compute path (card edits move to step 3).
- [x] 2.3 Remove the inline season-rollover block from the compute path; keep computing and returning `seasonStatus` (including `isLastFireOfSeason`).
- [x] 2.4 Return the processed `batchId` (or singleton question id for legacy rows) in the payload so the prompt can thread it to the projector.
- [x] 2.5 Confirm freeform judging still touches only pending rows (`correct === undefined`) and that re-running reuses existing verdicts (replay invariant 4).
- [x] 2.6 Delete the `process_reveal_answers` registration; ensure no tool by that name remains.

## 3. Build `update_answers_block` (the deterministic projector)

- [x] 3.1 Wrap `editCard.ts` / `footer.ts` behind a new `update_answers_block` tool taking `{ game, batchId }`, registered as `mcp__trivia__update_answers_block` at `admin` tier.
- [x] 3.2 Iterate every question in the batch; accept a real `batchId` OR a single question id (legacy/undefined-batchId) as the handle.
- [x] 3.3 Rebuild each card deterministically from stored `postedBlocks` + footer derived from current `answers.json`; never read current Slack message state.
- [x] 3.4 Make a per-card `chat.update` failure non-fatal (log, continue the batch, stay retryable).
- [x] 3.5 Verify idempotency: two consecutive calls with no file change produce identical cards; a call after a re-score reconciles to new verdicts.

## 4. Move rollover to `start_new_season`

- [x] 4.1 Ensure `start_new_season` performs the full rollover previously inlined in the reveal tool (stamp `endedAt`, create continuation with the existing inheritance/categories-reset rules, identify season MVP).
- [x] 4.2 Make `start_new_season` idempotent: no-op when `endedAt` is already set or a future continuation already exists; add a test for two consecutive last-fire calls.
- [x] 4.3 Migrate the rollover scenarios (continuation inheritance, categories reset, staged-future-season honoring, MVP, mid-season no-op) into the `start_new_season` capability/tests.

## 5. Rewire the scheduled reveal flow

- [x] 5.1 Update `PROCESS_REVEAL_INSTRUCTIONS` in `scheduledPrompts.ts` to the sequence: `compute_answers` → `update_answers_block(batchId)` → `start_new_season` (last fire only) → `submit_response`; keep the voter-shape and per-mode rendering instructions unchanged.
- [x] 5.2 Update `REVEAL_REQUIRED_TOOLS` in `buildGameSpecs.ts` to `["mcp__trivia__compute_answers", "mcp__trivia__update_answers_block"]`, adding `"mcp__trivia__start_new_season"` when the game has seasons enabled.
- [x] 5.3 Migrate any non-cron call site found in 1.2 to the two-step sequence.

## 6. Tests

- [x] 6.1 Split `processRevealAnswers.test.ts` into `computeAnswers.test.ts` (scoring/selection/payload/judge/round-summary/idempotency) and projector tests, re-pointing tool names.
- [x] 6.2 Add replay tests: re-run `compute_answers` after a judge fix re-derives from retained `answerText`; re-disclosure re-stamp triggers no new judge call; repeated compute does not double-count.
- [x] 6.3 Add projector tests: batch projection, single-id handle, repeated-call convergence, re-projection-after-rescore reconciliation, per-card failure isolation, admin re-run as repair primitive.
- [x] 6.4 Run the parity test from 1.1 against the new sequence; assert byte-identical cards + summary + leaderboard for every captured fixture.
- [x] 6.5 Update the `trivia-scheduled-prompts` prompt-inspection tests for the new tool names and the projection/rollover steps.

## 7. Specs & verification

- [x] 7.1 Run `/opsx:sync` (or equivalent) to fold the deltas into the base specs; re-point the retained `trivia-reveal-processor` scenarios' tool name from `process_reveal_answers` to `compute_answers`.
- [x] 7.2 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 7.3 Full `npm test` green; confirm no user-observable change in reveal output.
- [x] 7.4 Run `graphify update .` to refresh the knowledge graph for the moved/renamed reveal tools.
