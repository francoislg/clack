## Why

The trivia send-question flow has a silent data integrity bug: after the recent reveal rework, `process_reveal_answers` requires `postedAt` and `messageLink` to be set on the question record to find and fetch the Slack message, but `SEND_QUESTIONS_INSTRUCTIONS` no longer instructs Claude how to record them. Claude improvises — guessing `postedAt` from the cron schedule and fabricating a permalink from `Date.now()` — producing a question with a stale `postedAt` and a `messageLink` whose `ts` doesn't match the real posted message. The next reveal can't fetch the message and scores nothing.

The root cause is structural: `submit_response` is the wrong seam for an N-message structured artifact. It returns no `ts` to Claude, is terminal/once-per-run, and doesn't scale to multi-question quizzes (a future goal). Posting a trivia question is a plugin-owned action that should commit the Slack post and the database stamp atomically.

## What Changes

- Add a new MCP tool `post_questions({ game, items: [{ questionId, blocks }] })` in the trivia plugin that, per item: posts the question to Slack, retrieves the real permalink, stamps `postedAt` + `messageLink` on the question record, and adds vote reactions. Reactions are derived from the stored question type (boolean → 👍/👎, choice → numeric reactions sized to `choices.length`), not passed by Claude. Channel is resolved from `config.trivia.games[game].channel`. The tool is idempotent: a question with `postedAt` already set is skipped with `ok: true`.
- Extract a new shared helper `src/slack/messagePoster.ts` exporting `postStructuredMessage(client, opts)` that wraps `chat.postMessage` + `chat.getPermalink` and returns `{ ts, permalink }`. `addDeliveryReactions` remains separate as today (`src/slack/messageReactions.ts`). The trivia tool and `submit_response`'s top-level delivery path in `handlerResponse.ts` both call the helper.
- Refactor `submit_response`'s top-level delivery in `src/slack/handlers/handlerResponse.ts` to use the new helper. No behavioral change — same blocks posted, same reactions added, same `ts` returned to the delivery context.
- Update `SEND_QUESTIONS_INSTRUCTIONS` (in `src/plugins/trivia/prompts/scheduledPrompts.ts`) step 10: instead of "deliver via `submit_response` with reactions: [...]", Claude builds the Block Kit card, calls `post_questions({ game, items: [{ questionId, blocks }] })`, then calls `submit_response({ skip_response: true })` to terminate the run.
- Update `buildGameSpecs.ts` so the per-game question-posting cron spec includes `requiredTools: ["post_questions"]`. The reveal spec is unchanged.
- The `submit_answers` tool's first-call stamping behavior is preserved as a defensive fallback but is no longer the primary path. Removing it is out of scope for this change.

## Capabilities

### New Capabilities

- `trivia-question-posting`: an MCP tool that posts a saved trivia question (or multiple) to a Slack channel and stamps `postedAt` + `messageLink` on each question record atomically. Owns the channel resolution from game config, reaction derivation from question type, and idempotency on `questionId`.

### Modified Capabilities

- `trivia-scheduled-prompts`: `SEND_QUESTIONS_INSTRUCTIONS` step 10 is rewritten — Claude posts via `post_questions` and ends the run with `submit_response({ skip_response: true })`. Reactions are no longer specified by Claude. `PROCESS_REVEAL_INSTRUCTIONS` is unchanged.
- `trivia-managed-schedules`: the question-posting cron spec (`specKey: "<name>:question"`) gains `requiredTools: ["post_questions"]`. The reveal spec is unchanged.

## Impact

- **New file**: `src/slack/messagePoster.ts` (shared helper).
- **New file**: `src/plugins/trivia/tools/questions/postQuestions.ts` (MCP tool implementation).
- **Edited**: `src/slack/handlers/handlerResponse.ts` (top-level delivery uses the helper).
- **Edited**: `src/plugins/trivia/index.ts` (registers the new tool).
- **Edited**: `src/plugins/trivia/prompts/scheduledPrompts.ts` (`SEND_QUESTIONS_INSTRUCTIONS` step 10).
- **Edited**: `src/plugins/trivia/domain/buildGameSpecs.ts` (`requiredTools` on question spec).
- **No data migration**: existing posted questions are unaffected. Questions in flight when the change deploys remain stamped by whatever method recorded them; only future cron runs go through the new path.
- **No breaking config changes**: `config.trivia.games[]` shape unchanged.
- **No breaking SDK changes**: the plugin SDK is unchanged.
- **Phase-2 readiness**: the same tool scales trivially to N items per call, enabling future "5 questions per quiz" without further tool changes.
- **Phase-3 awareness**: a future change MAY introduce a `deliverableTool` field on cron jobs to drop the `submit_response({ skip_response: true })` ceremony — not in scope here.
