## RENAMED Requirements

- FROM: `### Requirement: \`process_reveal_answers\` MCP tool`
- TO: `### Requirement: \`compute_answers\` MCP tool`

## ADDED Requirements

### Requirement: `compute_answers` replaces `process_reveal_answers` as a compute-only tool

The trivia plugin SHALL register the reveal-compute tool under the name `compute_answers` (callable as `mcp__trivia__compute_answers`), at the `admin` tier. It SHALL be the renamed successor of `process_reveal_answers`: every retained requirement in this capability — batch selection, reading scored rows from `answers.json`, the discriminated `voters` payload, the freeform per-answer judge, the leaderboard/`roundSummary`/`seasonStatus` payload, `processedAt` stamping, `asOf` handling, reprocess mode, and the idempotency of repeated default-mode calls — SHALL continue to describe `compute_answers` unchanged under the new name.

Two responsibilities that previously lived inside the tool are removed (see the REMOVED requirements below): the tool SHALL NOT edit any Slack message (card edits move to `update_answers_block` in `trivia-card-projection`), and the tool SHALL NOT perform season rollover (rollover moves to `start_new_season`). The tool SHALL still **report** `seasonStatus` (including `isLastFireOfSeason`) so the caller can decide whether to invoke rollover.

#### Scenario: Tool is registered as compute_answers

- **WHEN** the trivia plugin loads
- **THEN** a tool named `compute_answers` is registered on the trivia MCP server with `minRole: "admin"`, callable as `mcp__trivia__compute_answers`
- **AND** no tool named `process_reveal_answers` is registered

#### Scenario: Retained scoring behavior is unchanged under the new name

- **GIVEN** a posted boolean question with `isTrue: true` and `answers.json` rows `{ U1: true (correct), U2: false (wrong) }`
- **WHEN** `compute_answers({ game })` is called
- **THEN** `reveals[0].voters.correct` contains U1 and `voters.incorrect` contains U2
- **AND** the returned `leaderboard`, `roundSummary`, and (when seasons enabled) `seasonStatus` are computed exactly as the prior `process_reveal_answers` tool produced them

### Requirement: `compute_answers` performs no Slack write

`compute_answers` SHALL NOT call any Slack write API (`chat.update`, `chat.postMessage`, `files.uploadV2`, etc.). It SHALL only read Slack message reactions as commentary signal (as today). All editing of already-posted question cards SHALL be performed by `update_answers_block` (`trivia-card-projection`). A failure to reach Slack for the reaction read SHALL degrade gracefully (empty reactions) and SHALL NOT block the scored payload.

#### Scenario: No card edit occurs during compute

- **WHEN** `compute_answers({ game })` processes a batch
- **THEN** no question's Slack message is edited by this tool
- **AND** the question cards retain their pre-reveal (interactive) state until `update_answers_block` runs

#### Scenario: Reaction-read failure does not block the payload

- **WHEN** `compute_answers` cannot fetch a message's reactions
- **THEN** the payload still returns with scored `voters` buckets and an empty `reactions` list for that entry

### Requirement: Reveal steps are atomic and independently replayable

The reveal SHALL be decomposable into steps that each do one thing and are individually safe to retry, so that an admin can re-run any single step without corrupting state. The following invariants SHALL hold:

1. **Raw inputs are never overwritten except by re-derivation.** The raw submission data in `answers.json` (button choice / chosen index / typed freeform `answerText`) is the immutable source of truth; `compute_answers` derives the `correct` verdict FROM it and SHALL NOT overwrite the raw submission with the verdict. Re-judging a freeform question is possible only because the typed text is retained.
2. **Every reveal-tool write overwrites or re-derives, never appends.** Re-running `compute_answers` on the same batch re-derives the verdict and replaces it in place; it SHALL NOT accumulate duplicate rows or double-count.
3. **`processedAt` is informational and SHALL NOT gate a reprocess.** Reprocess mode (`reprocessQuestionIds`) SHALL operate regardless of whether `processedAt` is already set.
4. **Re-judging touches only pending rows.** `compute_answers` SHALL judge a freeform submission only when its `correct` is `undefined`; rows already carrying a verdict SHALL be reused, so re-running `compute_answers` after a disclosure-mode re-stamp makes no new judge call.

#### Scenario: Re-running compute after a judge fix re-derives from retained raw text

- **GIVEN** a freeform question whose rows were scored, and the judge logic is then corrected
- **WHEN** an admin clears the affected rows' verdicts and re-runs `compute_answers` (or reprocesses the question)
- **THEN** the verdicts are re-derived from the retained `answerText` using the corrected judge
- **AND** the raw `answerText` of each row is unchanged

#### Scenario: Re-disclosure makes no new judge call

- **GIVEN** a freeform question whose rows are all already judged, re-stamped from `revealResponses: "just-correctness"` to `"yes"`
- **WHEN** `compute_answers` is re-run for that batch
- **THEN** zero `sdk.askClaude` judge calls are made (existing verdicts are reused)
- **AND** the `voters` payload now carries the `"yes"`-shaped buckets

#### Scenario: Repeated compute does not double-count

- **GIVEN** a batch already processed once by `compute_answers`
- **WHEN** the same batch is reprocessed
- **THEN** `answers.json` contains no duplicated rows for those questions and the leaderboard totals are unchanged

## REMOVED Requirements

### Requirement: Season rollover happens inside the tool

**Reason**: Season rollover is the single irreversible state-machine move in the reveal; keeping it inside the compute step makes the compute step unsafe to replay (re-running on the season's last fire would roll over twice). Moving it to its own guarded step is required for the atomic-replay guarantee.

**Migration**: The rollover (stamp `endedAt`, create the continuation season with its existing inheritance rules, identify the season MVP) moves entirely to the `start_new_season` tool, which SHALL be idempotent (no-op when `endedAt` is already set or a future continuation already exists). `compute_answers` continues to *report* `seasonStatus.isLastFireOfSeason`; the scheduled reveal prompt invokes `start_new_season` on the last fire (see `trivia-scheduled-prompts`). All rollover scenarios (continuation inheritance, categories reset, staged-future-season honoring, MVP identification, mid-season no-op) are migrated to the `start_new_season` capability.

### Requirement: Reveal flow edits each processed question's original message

**Reason**: Editing the Slack card from inside the compute tool couples the deterministic scoring step to the fragile, independently-failing Slack write, and prevents an admin from re-projecting a card without re-scoring. The card edit becomes its own addressable, file-state-driven step.

**Migration**: The static card edit moves to the new `update_answers_block` tool (`trivia-card-projection`), which is admin-callable, operates over a whole batch, reads current `questions.json` + `answers.json`, and is idempotent. The card-rendering rules themselves are unchanged and continue to be specified in `trivia-reveal-cards`. The scheduled reveal prompt calls `update_answers_block` after `compute_answers`.
