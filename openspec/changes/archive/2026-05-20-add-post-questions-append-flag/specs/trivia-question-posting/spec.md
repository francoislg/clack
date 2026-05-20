## ADDED Requirements

### Requirement: post_questions Accepts appendToPreviousBatch Flag

The `post_questions` MCP tool SHALL accept an OPTIONAL boolean argument `appendToPreviousBatch` on its input schema. The argument SHALL default to `false`. The default value SHALL preserve the existing behavior bit-for-bit (mint a fresh UUID per call and stamp it on every freshly-posted item).

When `appendToPreviousBatch` is `true`, the tool SHALL resolve a "previous batch" before stamping any item by reading `games/<game>/questions.json` and selecting the group of questions sharing a single non-empty `batchId` whose maximum `postedAt` is the largest. The tool SHALL then stamp every freshly-posted item in this call with that resolved `batchId` (instead of minting a new UUID).

Idempotent-skip semantics SHALL be identical regardless of the flag value: a question whose record already has `postedAt` set is skipped and its existing `batchId` is preserved unchanged.

#### Scenario: appendToPreviousBatch reuses the most-recent batch's UUID

- **GIVEN** `games/main/questions.json` contains `Q1` and `Q2` from a prior call, both with `postedAt` set, `processedAt` unset, and `batchId: "batch-AAA"`
- **AND** `Q3` is freshly saved with no `postedAt`, no `processedAt`, and no `batchId`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q3", blocks }], appendToPreviousBatch: true })` is called and the Slack post succeeds
- **THEN** `Q3`'s `batchId` on disk after the call equals `"batch-AAA"`
- **AND** `Q1` and `Q2` are unchanged

#### Scenario: Default behavior is preserved when the flag is absent or false

- **GIVEN** `games/main/questions.json` contains `Q1` with `postedAt` set, `processedAt` unset, and `batchId: "batch-AAA"`
- **AND** `Q2` is freshly saved
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q2", blocks }] })` is called (no `appendToPreviousBatch` field)
- **THEN** `Q2`'s `batchId` on disk after the call is a NEW UUID, distinct from `"batch-AAA"`

- **WHEN** the same call is made with `appendToPreviousBatch: false`
- **THEN** the result is identical (a fresh UUID, distinct from `"batch-AAA"`)

#### Scenario: "Most recent batch" is the group with the largest max(postedAt)

- **GIVEN** `games/main/questions.json` contains:
  - `Q1` with `postedAt: 100`, `batchId: "batch-OLD"`
  - `Q2` with `postedAt: 200`, `batchId: "batch-OLD"`
  - `Q3` with `postedAt: 150`, `batchId: "batch-NEW"`
  - `Q4` with `postedAt: 300`, `batchId: "batch-NEW"`
- **AND** `Q5` is freshly saved
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q5", blocks }], appendToPreviousBatch: true })` is called
- **THEN** `Q5`'s `batchId` on disk equals `"batch-NEW"` (chosen because its max `postedAt` of 300 is the largest)

#### Scenario: Multiple fresh items in one appendToPreviousBatch call all share the resolved batchId

- **GIVEN** a previous batch `"batch-AAA"` exists with no `processedAt`
- **AND** `Q4` and `Q5` are freshly saved
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q4", blocks }, { questionId: "Q5", blocks }], appendToPreviousBatch: true })` is called and both posts succeed
- **THEN** both `Q4` and `Q5` have `batchId: "batch-AAA"` on disk

### Requirement: post_questions Fails Atomically When Appending to a Revealed Batch

When `appendToPreviousBatch: true` is passed and the resolved "previous batch" contains AT LEAST ONE question whose `processedAt` is set, the tool SHALL fail the entire call atomically. The tool SHALL NOT call Slack's `chat.postMessage` for any item, SHALL NOT call `chat.getPermalink`, SHALL NOT attach reactions, and SHALL NOT mutate any question record on disk (no `postedAt`, no `messageLink`, no `batchId` writes).

The returned error SHALL be a structured tool error (not a per-item failure inside the `results` array) that identifies the offending `batchId` and at least one question id within that batch whose `processedAt` is set. The error message SHALL make clear that appending would resurrect an already-revealed round.

#### Scenario: Append-to-revealed-batch is rejected before any side effect

- **GIVEN** `games/main/questions.json` contains `Q1` and `Q2` both with `batchId: "batch-AAA"` and `Q1.processedAt: 5000` (already revealed)
- **AND** `Q3` is freshly saved
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q3", blocks }], appendToPreviousBatch: true })` is called
- **THEN** the tool returns a structured error (not a `results` array with `ok: false`)
- **AND** the error references `batch-AAA` and at least one of `Q1` / `Q2`
- **AND** no Slack API call was made
- **AND** `Q3`'s on-disk record is unchanged (still no `postedAt`, no `batchId`)

#### Scenario: Append succeeds when the previous batch has no processedAt anywhere

- **GIVEN** a previous batch `"batch-AAA"` exists with two questions, both with `processedAt` unset
- **AND** `Q3` is freshly saved
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q3", blocks }], appendToPreviousBatch: true })` is called
- **THEN** the tool proceeds normally and stamps `Q3` with `batchId: "batch-AAA"`

### Requirement: post_questions Fails Atomically When No Previous Batch Exists

When `appendToPreviousBatch: true` is passed and the game's `questions.json` contains NO question with a non-empty `batchId`, the tool SHALL fail the entire call atomically with a structured error (no Slack calls, no record mutations). The tool SHALL NOT silently fall back to minting a fresh UUID.

#### Scenario: Empty game rejects the append flag

- **GIVEN** `games/main/questions.json` is empty (or contains only legacy rows with no `batchId`)
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }], appendToPreviousBatch: true })` is called
- **THEN** the tool returns a structured error stating there is no previous batch for game `main`
- **AND** no Slack API call was made
- **AND** `Q1`'s record is unchanged

### Requirement: post_questions Append-Flag Validation Runs Before Per-Item Loop

The previous-batch resolution and the revealed-batch / no-batch checks SHALL run BEFORE the tool iterates over `items[]`. Per-item failures (validation errors, idempotency skips, Slack errors) SHALL NOT mask an append-flag misuse — the misuse SHALL surface as a top-level call error even when every item would otherwise have been idempotent-skipped.

#### Scenario: Append-flag misuse short-circuits idempotent-skip

- **GIVEN** the previous batch is already revealed
- **AND** every item in the call refers to a question whose `postedAt` is already set (would normally be idempotent-skipped)
- **WHEN** `post_questions({ game: "main", items: [...], appendToPreviousBatch: true })` is called
- **THEN** the tool returns the append-flag error (not a `results` array of idempotent skips)
