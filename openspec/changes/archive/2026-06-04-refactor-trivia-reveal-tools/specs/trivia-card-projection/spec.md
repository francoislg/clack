## ADDED Requirements

### Requirement: `update_answers_block` MCP tool projects file state onto posted cards

The trivia plugin SHALL register an `admin`-tier MCP tool named `update_answers_block` (callable as `mcp__trivia__update_answers_block`) taking `{ game: string, batchId: string }`. The tool SHALL be the deterministic projector that edits already-posted trivia question cards into their revealed state by reading the current `games/<game>/questions.json` + `games/<game>/answers.json` and calling `chat.update` once per question in the batch. It SHALL be the **sole editor of already-posted question cards** — no other tool performs `chat.update` on a question message.

The tool SHALL NOT score answers, run the freeform judge, mutate season state, or post any new message. Its only effect is to bring each card's Slack content in line with current file state. The rendering of each card (preserve body, remove answer-actions block, append the static results footer per the question's stamped `revealResponses`, append the "See your answer" button) SHALL follow the rules specified in `trivia-reveal-cards`.

The `batchId` argument SHALL accept either a real `batchId` shared by a multi-question batch OR a single question's `id` for legacy/undefined-`batchId` rows (mirroring the singleton-group key used by `compute_answers` batch selection).

#### Scenario: Tool registers at admin tier

- **WHEN** the trivia plugin loads
- **THEN** `update_answers_block` is registered on the trivia MCP server with `minRole: "admin"`, callable as `mcp__trivia__update_answers_block`

#### Scenario: Projects every card in the batch

- **GIVEN** a batch of three processed questions sharing `batchId: "batch-A"` with scored rows in `answers.json`
- **WHEN** `update_answers_block({ game, batchId: "batch-A" })` is called
- **THEN** each of the three question messages is edited via `chat.update` into its revealed state
- **AND** each edited card follows the `trivia-reveal-cards` rendering rules for that question's stamped `revealResponses` mode

#### Scenario: Accepts a single question id as the batch handle

- **GIVEN** a legacy question `Q_legacy` with no `batchId`
- **WHEN** `update_answers_block({ game, batchId: "Q_legacy" })` is called
- **THEN** `Q_legacy`'s card is edited into its revealed state

#### Scenario: Tool performs no scoring, judging, rollover, or new post

- **WHEN** `update_answers_block` runs
- **THEN** no `answers.json` row is added or re-scored, no freeform judge call is made, no season entry is mutated, and no new Slack message is posted

### Requirement: Projection is idempotent and reconciling

`update_answers_block` SHALL be safe to call repeatedly. Each card SHALL be rebuilt deterministically from the question's stored `postedBlocks` plus the footer derived from current `answers.json` (never from the message's current Slack state), so repeated calls converge to the same final card and cannot accumulate stale blocks. Running the tool again after `answers.json` has changed (e.g. a re-score or a disclosure re-stamp) SHALL reconcile the card to the new state. A `chat.update` failure for one card (deleted message, rate limit) SHALL be logged, SHALL NOT abort the rest of the batch, and SHALL leave the run retryable.

#### Scenario: Repeated projection converges

- **WHEN** `update_answers_block` is called twice in a row with no intervening file change
- **THEN** the second call produces a card identical to the first (rebuilt from `postedBlocks`, not from current Slack state)

#### Scenario: Re-projection after a re-score reconciles the card

- **GIVEN** a card already projected, then `answers.json` is corrected by a re-run of `compute_answers`
- **WHEN** `update_answers_block` is called again for the batch
- **THEN** the card's results footer reflects the corrected verdicts

#### Scenario: One card's update failure does not abort the batch

- **GIVEN** a three-question batch where the second message was deleted
- **WHEN** `update_answers_block` runs
- **THEN** the first and third cards are still edited
- **AND** the failure on the second is logged and the call still returns

#### Scenario: Repair primitive after partial failure

- **GIVEN** a reveal where `compute_answers` succeeded but the card edits failed midway
- **WHEN** an admin re-runs `update_answers_block({ game, batchId })`
- **THEN** all cards in the batch are reconciled to current file state without re-scoring
