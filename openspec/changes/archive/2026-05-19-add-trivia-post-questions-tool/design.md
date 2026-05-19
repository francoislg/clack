## Context

Today's trivia send-question flow has two coupled problems:

1. **Stamping gap**: `SEND_QUESTIONS_INSTRUCTIONS` ends after `submit_response` but `process_reveal_answers` requires `postedAt` + `messageLink` on the question record. Nothing in the prompt sets them. Claude improvises with `Date.now()` and a fabricated permalink — verified by inspecting today's question record (`postedAt` rounded to the minute, `messageLink` ts 38 seconds later, mismatching).

2. **Wrong seam**: `submit_response` is a once-per-run terminal gate that doesn't return the delivered `ts` to Claude. It cannot be the seam for an N-message structured artifact like a multi-question quiz.

The first is a bug; the second is the reason the bug is hard to fix in place.

Plugin tools have direct access to the Slack client via `sdk.getSlackClient()`. Trivia stores questions per game in `data/plugins/trivia/games/<name>/questions.json`. The existing `addDeliveryReactions` helper in `src/slack/messageReactions.ts` is already cross-cutting. The pieces to build a plugin-owned posting tool exist; they just need to be assembled.

This is also the architectural pivot needed for the user's known future goal of "5 questions per quiz" — explicitly called out in our exploration phase. Designing the tool to accept `items: [...]` (length 1 today, length N later) keeps that path open with no further tool changes.

## Goals / Non-Goals

**Goals:**

- Eliminate the data integrity gap so `process_reveal_answers` reliably finds the message and scores the right reactions.
- Make `postedAt` + `messageLink` stamping atomic with the Slack post, indexed by `questionId` so there is no race condition between overlapping runs.
- Support 1 question per run today and 5 (or any N) per run in the future without further tool-shape changes.
- Make the posting flow idempotent on `questionId` so retries can't double-post.
- Extract `chat.postMessage` + `chat.getPermalink` as a single shared helper so plugins and core delivery use the same primitive.
- Preserve Claude's creative control over the question card (header banter, layout, closer) — only the mechanical bits (reactions, channel) move into the tool.

**Non-Goals:**

- Removing `submit_response` from the send-question flow. Phase 1 retains `submit_response({ skip_response: true })` as the run terminator; replacing the gate with a plugin-owned `deliverableTool` is a separate future change.
- Removing or deprecating `submit_answers`. Its first-call stamping logic stays as a defensive fallback. Cleanup is out of scope.
- Backfilling the one broken question already in production (`b474d06a-…`). The user already fixed it manually.
- Changing reveal-side behavior. `process_reveal_answers` is untouched.
- Introducing per-message correlation tokens, session-aware tool context, or a job-completed SDK hook. The atomicity story is "the tool that posts also stamps," not "two operations correlated after the fact."
- Changing `config.trivia.games[]` schema or the plugin SDK shape.

## Decisions

### Decision 1: Plugin-owned posting tool, not a runtime hook

Three approaches were explored:

- (A) Runtime hook fires after `executeDynamicJob` captures `responseTs`; trivia stamps the most-recent unstamped question.
- (B) Surface `ts` to Claude via `submit_response` result; require Claude to call `submit_answers` (or a new tool) afterward.
- (C) Plugin tool that posts + stamps atomically, indexed by `questionId`.

**Choice: C.** A and B both assume "one delivery per run" — they fall apart when one run produces five Slack messages (the documented future goal). A also has a race: two overlapping runs for the same game both end up matching "the most recent unstamped question," cross-contaminating each other's `responseTs`. C avoids all of this because the tool argument carries the correlation key (`questionId`) and the stamping happens before the tool returns.

### Decision 2: Reactions derived in the tool, blocks built by Claude

`SEND_QUESTIONS_INSTRUCTIONS` today devotes a sub-section to "use reactions: ['+1', '-1'] in this exact order" for boolean questions and "use reactions: ['one', 'two', 'three', 'four'] sized to suggestedChoiceCount" for choice questions. These are 100% derivable from the stored question (`type` + `choices.length`). Asking Claude to pass them creates a class of avoidable mistakes (wrong count, wrong order, wrong emoji).

The Block Kit card itself — header banter, warm-up patter, card title/body, closer — is where the Game Show Presenter voice lives. That stays with Claude. The split is "creative content vs. mechanical defaults."

### Decision 3: Channel resolved from game config, not passed in args

The cron job's `channel` field and `config.trivia.games[game].channel` are the same value by construction (the cron is reconciled from game config via `buildGameSpecs.ts`). The tool reads `config.trivia.games[game].channel` directly. Claude doesn't pass a channel, doesn't risk passing the wrong one, and doesn't need a new template variable in the prompt.

If the cron's channel drifts from the game config (manually edited), the cron fires in channel X but the tool posts to channel Y. That's a config-drift bug worth a startup consistency check (out of scope here) but not worth designing the tool around.

### Decision 4: Shared helper at the postMessage+getPermalink layer, not higher

Reviewed `handlerResponse.ts:255-363` (`buildDeliverFn`) and ruled out extracting the top-level delivery wholesale: it carries reply-specific machinery (streamer hand-off, alreadyDelivered guard, follow-up session creation, top-level post deletion of the streamer message) that plugin tools don't want. The clean primitive is:

```
postStructuredMessage(client, { channel, blocks, threadTs? })
  → { ts, permalink }
```

…implemented as `chat.postMessage` + `chat.getPermalink`. Reactions stay separate (`addDeliveryReactions` is already shared).

`submit_response`'s top-level delivery is NOT refactored to call `postStructuredMessage`. It currently posts via `chat.postMessage` and discards the message ts back to Claude — it has no use for a permalink. Routing it through the helper would add a `chat.getPermalink` Slack API round-trip per submit_response delivery for zero downstream benefit. What IS shared between the two paths is the `notificationText(blocks)` utility (the same 500-char truncation logic), which moves into `messagePoster.ts` and is imported by both `handlerResponse.ts` and `postStructuredMessage`. That's the minimum cross-cutting extraction that's actually needed.

### Decision 5: Idempotency on `questionId`, per-item results

`post_questions` accepts `items: [{ questionId, blocks }, ...]`. For each item: if `question.postedAt` is already set, skip with `{ ok: true, ts: question.postedAt, permalink: question.messageLink }`. Otherwise post, stamp, return. The whole-tool result is `{ results: Array<{ questionId, ok, ts?, permalink?, error? }> }` — per-item success/failure, no all-or-nothing aborting.

This makes retry safe (re-call with the same items; already-posted ones no-op) and gives Claude something to react to on partial failure (e.g. one post hits a Slack rate limit while four succeed).

### Decision 6: `submit_response({ skip_response: true })` retained as run terminator

The required-tools gate (`requiredTools: ["post_questions"]` on the cron spec) ensures `post_questions` was called before the run terminates, but the run still needs `submit_response` to fire so the existing gate machinery (intent-coverage check, alreadyDelivered flag, session bookkeeping) runs. `skip_response: true` is already a supported parameter for "I'm done, don't post a reply." This is the minimum-disruption phase-1 ending.

Phase 3 would introduce a `deliverableTool` on the cron job that drops this ceremony. Out of scope here.

### Decision 7: Tool registered at `admin` role

Matches `save_question`, `save_cheating`, and other trivia admin tools. The cron job runs with `roleOverride: "system"` (from `cronScheduler.ts:304`) which has admin+ access. Direct user-triggered posting (via `run_scheduled_message_now`) requires admin or the job's creator, also covered.

## Risks / Trade-offs

[**Risk: dual stamping paths still exist** — `submit_answers` retains its first-call stamping branch.] → Acceptable because the cron flow no longer calls `submit_answers`, so the branch becomes practically dead. Removing it is a separate cleanup, sequenced for after this change ships and we confirm no other caller hits it.

[**Risk: `chat.getPermalink` adds an extra Slack API round-trip per posted question.**] → Acceptable. Slack's rate limit on `chat.getPermalink` is generous (Tier 4), and posting is already a multi-call operation (postMessage + N reactions). One additional read is negligible.

[**Risk: partial failure mid-batch leaves some questions posted-and-stamped, others not.**] → By design. Per-item results let the caller (Claude or the prompt logic) decide whether to retry. The alternative (transactional all-or-nothing across N posts) requires the ability to delete posted messages — possible but adds complexity for a scenario that's rare.

[**Risk: `responseTs` in job-run history becomes undefined for trivia jobs**] → Acceptable. `responseTs` was used by `replaceResponseTs` in `run_scheduled_message_now` to delete a prior bot post. For multi-question trivia, "the response ts" was never well-defined anyway. Job-run history records "success" without a single ts; replay/replace semantics for trivia would need to look up question records, not the job-run row. Document this in the spec; defer the replay UX to phase 3.

[**Risk: Claude forgets to call `post_questions` and the run completes without posting.**] → Mitigated by `requiredTools: ["post_questions"]` on the cron spec — `submit_response` will refuse delivery until `post_questions` was called at least once. Existing `submit_response` machinery.

[**Risk: orphaned question record if `post_questions` is never successfully called for a saved question.**] → Same as today: a saved-but-never-posted question stays in `questions.json` without `postedAt`. The reveal filter (`postedAt !== undefined`) skips it, which is correct. No regression.

[**Risk: config drift between cron's `channel` and `config.trivia.games[game].channel`.**] → Worth a startup consistency check, but out of scope. In practice, both are reconciled from `config.trivia.games[]` by `buildGameSpecs.ts` on every plugin load, so drift is hard to introduce.

[**Risk: deploy ordering — old cron jobs with no `requiredTools` value fire under new code.**] → `reconcileCronJobs` runs on every plugin load (i.e. on every restart, including post-deploy). It rewrites the cron specs from `buildGameSpecs` which now includes `requiredTools: ["post_questions"]`. As long as the plugin reloads after deploy, all existing trivia crons get the new required-tools list. Worst case: a cron fires once between deploy and reload, hitting the old prompt — same behavior as today (the bug we're fixing). No new failure mode.
