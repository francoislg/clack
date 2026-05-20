## ADDED Requirements

### Requirement: post_questions Stamps a Shared batchId on Every Item Posted in One Call

The `post_questions` tool SHALL generate ONE batch identifier per invocation (a string produced by `crypto.randomUUID()`) and SHALL stamp the SAME `batchId` value on every question record it freshly posts within that single call. The stamp SHALL be written to disk in the same `updateQuestion` operation that writes `postedAt` and `messageLink` — atomically, before reactions are added.

Items in the same call that hit the idempotent-skip branch (the question record already has `postedAt` set) SHALL NOT have their `batchId` overwritten or rewritten. Whatever `batchId` is already on the row remains untouched, including when it is `undefined` (legacy rows).

`batchId` SHALL be an OPAQUE coordination identifier — its value SHALL NEVER be surfaced in user-facing Slack output, log lines reserved for end-user display, or tool descriptions read by Claude as instructions. It is internal metadata consumed by `process_reveal_answers` only.

When a manual operator calls `post_questions` twice with overlapping `items` arrays, items posted in the second call (those not skipped by idempotency) SHALL receive a NEW `batchId`, distinct from the first call's batchId. This SHALL be the expected behavior — the system itself never produces this call pattern in the cron-driven flow.

#### Scenario: All fresh items in one call share the same batchId

- **GIVEN** `games/main/questions.json` contains `Q1`, `Q2`, `Q3`, all without `postedAt`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }, { questionId: "Q2", blocks }, { questionId: "Q3", blocks }] })` is called and all three posts succeed
- **THEN** after the call returns, `Q1`, `Q2`, and `Q3` on disk each carry the SAME non-empty string `batchId` value
- **AND** that value is a valid UUID (lowercase, RFC 4122 format)
- **AND** the value is NOT present in the `results[]` array returned to Claude

#### Scenario: Idempotency-skipped item keeps its original batchId

- **GIVEN** `Q1` in `games/main/questions.json` already has `postedAt: 1000` and `batchId: "batch-aaaa"`
- **AND** `Q2` in the same file has no `postedAt` and no `batchId`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }, { questionId: "Q2", blocks }] })` is called
- **THEN** `Q1`'s `batchId` after the call is still `"batch-aaaa"`
- **AND** `Q2`'s `batchId` after the call is a new UUID, different from `"batch-aaaa"`

#### Scenario: All items already posted — no new batchId is generated or stamped

- **GIVEN** `Q1` and `Q2` both already have `postedAt` and a `batchId` from a prior call
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }, { questionId: "Q2", blocks }] })` is called
- **THEN** both rows' `batchId` values remain unchanged
- **AND** no `updateQuestion` write occurs for either row (both items hit the idempotent-skip branch)
- **AND** `results[]` reflects each item's prior `ts` (derived from the stored `postedAt`) and `messageLink`

#### Scenario: batchId is independent across calls

- **GIVEN** a first call posts `Q1` and `Q2`, stamping `batchId: "batch-A"` on both
- **WHEN** a second `post_questions` call posts a fresh `Q3`
- **THEN** `Q3`'s `batchId` is a new UUID distinct from `"batch-A"`

#### Scenario: Manual operator double-call splits a logical post into two batches

- **GIVEN** an admin calls `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }, { questionId: "Q2", blocks }] })` — both posted, both stamped `batchId: "batch-A"`
- **WHEN** the admin immediately calls `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }, { questionId: "Q2", blocks }, { questionId: "Q3", blocks }, { questionId: "Q4", blocks }] })`
- **THEN** `Q1` and `Q2` are idempotently skipped and retain `batchId: "batch-A"`
- **AND** `Q3` and `Q4` are freshly posted and BOTH carry a new shared `batchId: "batch-B"` (with `"batch-B" !== "batch-A"`)
