## REMOVED Requirements

### Requirement: Batch answer submission

**Reason**: The `submit_answers` MCP tool is deleted. Answers are now persisted at button-click time by an interactive action handler — there is no Claude-mediated batch submission step. The reveal flow reads `answers.json` directly for all three formats.

**Migration**: Callers of `submit_answers` (the reveal prompt) no longer need to call this tool. The reveal prompt is updated in `trivia-scheduled-prompts` to remove the call. No client-side migration of stored data is needed — `SubmittedAnswer` rows continue to be written with the same on-disk shape, just by a different code path.

### Requirement: Auto-register users on answer submission

**Reason**: Folded into the new interactive answer handler. When a user clicks a vote button or submits a freeform modal, the handler auto-registers the user in `users.json` (creating a row with `displayName` and `joinedAt`) exactly as `submit_answers` did. The behavior is preserved; only the trigger moves from a Claude tool call to a Slack action handler.

**Migration**: None required — the auto-registration is invariant; it is just performed at click time instead of at Claude-batch time.

### Requirement: Stamp question with posting metadata

**Reason**: `submit_answers` previously stamped `postedAt` / `messageLink` on the question as a fallback for the path where `post_questions` had not already done so. With the new flow, `post_questions` is the sole authoritative writer of those fields (and now also stamps `batchId`, `postedBlocks`, and `liveAnswersVisible`). The fallback path is dead code.

**Migration**: None required — `post_questions` already runs before any answers can be submitted; the stamp is always present.

### Requirement: Submit answers returns per-user results

**Reason**: There is no `submit_answers` tool return value to specify. Per-user stats (totalCorrect, totalAnswered, currentStreak, currentSeasonCorrect, currentSeasonAnswered) are computed inside `process_reveal_answers` at reveal time and surfaced via the `leaderboard` and `roundSummary` payload fields, which already cover this need.

**Migration**: None required — the leaderboard already conveys per-user stats; nothing else consumed the prior `submit_answers` results array.

### Requirement: Retrieve scores tool

**Reason**: `retrieve_scores` continues to exist as a standalone admin tool for ad-hoc queries; it is unaffected by this proposal. (This requirement is removed FROM the `trivia-batch-answers` capability only because the capability itself is being archived — the tool's spec lives elsewhere or is folded into `trivia-reveal-processor` as today.)

**Migration**: `retrieve_scores` callers continue to work unchanged. If a future cleanup moves its requirement spec to another capability, that move is independent of this proposal.

### Requirement: Pending Free-Form Answer Storage

**Reason**: The freeform "pending row" mechanism (a `SubmittedAnswer` with `correct === undefined`) is unchanged in behavior — the click writes a pending row, the reveal-time judge flips `correct` to a boolean. It is no longer specific to "batch answers" because there is no batch-answers capability. The same shape is now described directly in `trivia-freeform-questions` (or remains as on-disk schema documentation in code comments).

**Migration**: None required — the on-disk `SubmittedAnswer` shape is unchanged; the pending-row contract continues to hold.

### Requirement: Free-Form Answer Update Op

**Reason**: The `updateAnswer` data-layer method continues to exist for freeform verdict-flipping; the requirement just no longer lives in this capability. Its contract is preserved verbatim.

**Migration**: None required — `updateAnswer` callers (the freeform reveal path and the freeform modal-edit path) continue to use it unchanged.

### Requirement: Leaderboard and Score Aggregation Exclude Pending Rows

**Reason**: The "exclude `correct === undefined` rows from aggregates" rule is unchanged in behavior; it is implemented inside `computeLeaderboard`. The requirement is preserved as on-disk-schema invariant documentation but is no longer scoped to the (removed) batch-answers capability.

**Migration**: None required — `computeLeaderboard`'s exclusion logic is preserved.

### Requirement: Answer History Emits Optional Correct Field

**Reason**: The `correct?: boolean` optionality on `SubmittedAnswer` rows is unchanged. The requirement is preserved as on-disk-schema documentation.

**Migration**: None required.
