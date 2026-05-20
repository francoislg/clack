## Why

When `post_questions` posts multiple items and one fails (e.g. Slack rejects the Block Kit with `invalid_blocks`), Claude's natural retry path is a second `post_questions` call carrying only the failed items. But every call mints a fresh `batchId`, so the retried items land in a separate batch from the successes. At reveal time, `process_reveal_answers` reveals one batch per fire — so the original items get revealed today and the retried items get revealed on the NEXT cron fire, breaking the "one round = one reveal" contract for multi-slot seasons. A real production incident (game `clack-test`, 2026-05-20) revealed only 2 of 3 multi-slot questions for exactly this reason.

## What Changes

- Add an optional boolean argument `appendToPreviousBatch` to the `post_questions` MCP tool input schema. Default is `false` (preserves current behavior).
- When `appendToPreviousBatch: true`:
  - The tool reads the most-recent batch for the given game (the batch whose youngest `postedAt` is the highest among that game's questions) and reuses its `batchId` for every fresh item in this call.
  - The call FAILS atomically — no Slack posts, no question-record mutations — if any question in that most-recent batch already has `processedAt` set (the batch was already revealed). Appending to a revealed batch would resurrect a closed round, which would mis-score future reveals.
  - The call FAILS atomically if no prior batch exists for the game (nothing to append to).
- The default-mode behavior (a fresh `batchId` per call) is unchanged. Idempotent-skip semantics are unchanged.
- The scheduled question-posting prompt (`SEND_QUESTIONS_INSTRUCTIONS`) is updated to tell Claude: if `post_questions` returns per-item failures, retry the failed items in a follow-up call with `appendToPreviousBatch: true` so the retried items reveal together with the originals.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-question-posting`: adds the `appendToPreviousBatch` argument, the prior-batch-lookup behavior, and the "fail if already-revealed / no prior batch" guards.
- `trivia-scheduled-prompts`: the `send_questions_instructions` prompt gains a retry clause that names the `appendToPreviousBatch: true` argument.

## Impact

- `src/plugins/trivia/tools/questions/postQuestions.ts` — schema, handler logic, description text.
- `src/plugins/trivia/tools/questions/postQuestions.test.ts` — new scenarios for the flag (success, already-revealed rejection, no-prior-batch rejection).
- `src/plugins/trivia/prompts/scheduledPrompts.ts` — retry clause in step 10 of `SEND_QUESTIONS_INSTRUCTIONS`.
- No data-shape changes to `questions.json` — the flag only affects which `batchId` gets stamped on new rows.
- No changes required in `process_reveal_answers` — its existing "group by `batchId`, pick oldest batch" logic already handles the unified batch correctly.
