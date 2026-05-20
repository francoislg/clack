# trivia-question-posting Specification

## Purpose

The trivia plugin provides an MCP tool to post curated questions to Slack channels, stamp metadata (timestamp, permalink) back to the question record, and attach vote reactions. This capability is invoked by the scheduled question-posting run as the final step after Claude validates and formats a new question.

## Requirements

### Requirement: post_questions MCP Tool

The trivia plugin SHALL register an MCP tool named `post_questions` (admin role) that accepts a game name and an array of items — each item carrying a `questionId` and a `blocks` payload — and, for each item, posts the question to the game's configured Slack channel, retrieves the message's permalink, stamps `postedAt` and `messageLink` on the question record, and adds the appropriate vote reactions.

The tool's input schema SHALL be:

```ts
{
  game: string; // must match a writable entry in config.trivia.games[]
  items: Array<{
    questionId: string; // must exist in games/<game>/questions.json
    blocks: BlockKitBlocks; // Clack's curated Block Kit subset
  }>; // length >= 1
}
```

Channel resolution SHALL read `config.trivia.games[game].channel` at tool invocation time. The tool SHALL NOT accept a `channel` argument. The tool SHALL reject the call with a structured error when `config.trivia.games[game]` cannot be resolved or is disabled.

Reactions SHALL be derived per item from the stored question's `type` and (for choice questions) `choices.length`:

- `type === "boolean"` (or absent) → `["+1", "-1"]` in that order.
- `type === "choice"` → `["one", "two", "three", "four"].slice(0, question.choices.length)` in that order.

The tool SHALL NOT accept a `reactions` argument; the derivation is the only source.

The tool's return shape SHALL be:

```ts
{
  results: Array<{
    questionId: string;
    ok: boolean;
    ts?: string; // present iff ok === true
    permalink?: string; // present iff ok === true
    error?: string; // present iff ok === false
  }>;
}
```

Each item SHALL be processed independently: a failure on one item SHALL NOT abort processing of the remaining items, and each item's outcome SHALL be reported in the corresponding `results` entry.

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

#### Scenario: Successful single-item post stamps the question record

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", channel: "C123", enabled: true, ... }`
- **AND** `games/main/questions.json` contains a question with `id: "Q1"`, `type: "boolean"`, no `postedAt`, no `messageLink`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: <valid> }] })` is called
- **THEN** the message is posted to channel `C123` with the provided blocks
- **AND** `chat.getPermalink` is called for the resulting `ts`
- **AND** the question record is updated with `postedAt = floor(parseFloat(ts) * 1000)` and `messageLink = <permalink>`
- **AND** reactions `["+1", "-1"]` are added in that order to the posted message
- **AND** `results[0]` equals `{ questionId: "Q1", ok: true, ts: <slack-ts>, permalink: <permalink> }`

#### Scenario: Choice question derives numbered reactions sized to choices.length

- **GIVEN** `games/main/questions.json` contains a question with `id: "Q2"`, `type: "choice"`, `choices: ["a", "b", "c"]`, no `postedAt`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q2", blocks: <valid> }] })` is called
- **THEN** reactions `["one", "two", "three"]` are added in that order to the posted message
- **AND** the question record is stamped with `postedAt` and `messageLink`

#### Scenario: Multi-item batch posts each question and stamps each record

- **GIVEN** `games/main/questions.json` contains questions `Q1`, `Q2`, `Q3`, all without `postedAt`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: B1 }, { questionId: "Q2", blocks: B2 }, { questionId: "Q3", blocks: B3 }] })` is called
- **THEN** three separate Slack messages are posted to `C123` (one per item)
- **AND** each question record is independently stamped with its own `postedAt` and `messageLink`
- **AND** `results` contains three entries, each with `ok: true` and a distinct `ts` and `permalink`

#### Scenario: Idempotency — already-posted question is skipped

- **GIVEN** `games/main/questions.json` contains a question with `id: "Q1"`, `postedAt: 1000`, `messageLink: "https://existing/p"`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: <valid> }] })` is called
- **THEN** no new Slack message is posted for `Q1`
- **AND** the question record's `postedAt` and `messageLink` are NOT overwritten
- **AND** `results[0]` equals `{ questionId: "Q1", ok: true, ts: "1.000000", permalink: "https://existing/p" }` (reflecting the prior stamp)

#### Scenario: Per-item failure does not abort the batch

- **GIVEN** `games/main/questions.json` contains `Q1` (valid) and `Q2` (valid)
- **AND** `Q3` does NOT exist in the questions file
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: B1 }, { questionId: "Q3", blocks: B3 }, { questionId: "Q2", blocks: B2 }] })` is called
- **THEN** `Q1` and `Q2` are posted and stamped
- **AND** `results[0].ok === true` (for `Q1`)
- **AND** `results[1].ok === false` and `results[1].error` mentions that `Q3` was not found
- **AND** `results[2].ok === true` (for `Q2`)

#### Scenario: Unknown game is rejected

- **WHEN** `post_questions({ game: "does-not-exist", items: [...] })` is called
- **THEN** the call returns a structured error before any Slack API call
- **AND** no question record is modified

#### Scenario: Disabled game is rejected

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }`
- **WHEN** `post_questions({ game: "retired", items: [...] })` is called
- **THEN** the call returns a structured error
- **AND** no Slack message is posted

#### Scenario: Channel is resolved from game config, not from args

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", channel: "C_GAME", ... }`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: <valid> }] })` is called
- **THEN** the Slack post targets channel `C_GAME` (read from `config.trivia.games[main].channel`)
- **AND** the tool's input schema does NOT accept a `channel` field

### Requirement: post_questions Uses Shared Slack Posting Helper

`post_questions` SHALL post each message via a shared helper `postStructuredMessage(client, { channel, blocks, threadTs? })` exported from `src/slack/messagePoster.ts` that wraps `chat.postMessage` and `chat.getPermalink` and returns `{ ts, permalink }`. Any other path in Clack that posts a Block Kit message AND needs a permalink back SHALL call the same helper.

The same module SHALL export a `notificationText(blocks)` utility used by `postStructuredMessage` internally; `submit_response`'s top-level delivery path in `src/slack/handlers/handlerResponse.ts` SHALL import that utility (instead of redeclaring a local copy) to derive its push-notification fallback text. `submit_response`'s delivery is NOT required to call `postStructuredMessage` itself because it does not need a permalink back; introducing an extra `chat.getPermalink` round-trip per delivery would be wasted work.

Reaction attachment SHALL use the existing `addDeliveryReactions` helper from `src/slack/messageReactions.ts`. No new reaction-handling code SHALL be added.

#### Scenario: Shared helper is the single source for postMessage + getPermalink pairs

- **WHEN** any code path in Clack posts a Block Kit message to a Slack channel as a top-level (non-thread-reply) post and needs a permalink back
- **THEN** that path SHALL call `postStructuredMessage` from `src/slack/messagePoster.ts`
- **AND** the helper SHALL be the only place in the codebase that pairs `chat.postMessage` with `chat.getPermalink` for this purpose

#### Scenario: notificationText is exported and reused

- **WHEN** any code path in Clack derives the Slack notification-text fallback from rendered Block Kit blocks
- **THEN** it SHALL import `notificationText` from `src/slack/messagePoster.ts`
- **AND** `handlerResponse.ts` SHALL NOT contain a local copy of that function

#### Scenario: Reactions reuse the existing shared helper

- **WHEN** `post_questions` adds vote reactions to a posted message
- **THEN** it SHALL call `addDeliveryReactions` from `src/slack/messageReactions.ts`
- **AND** the existing 150ms inter-reaction delay SHALL be preserved (no per-call override needed)

### Requirement: post_questions Is Idempotent And Race-Free On questionId

The tool SHALL treat `questionId` as the correlation key. A question record with `postedAt` already set SHALL never be re-posted by a subsequent `post_questions` call, regardless of the run's origin (scheduled cron fire, `run_scheduled_message_now`, replay with `asOf`, or replay with `replaceResponseTs`).

#### Scenario: Concurrent overlapping runs for the same game do not cross-contaminate

- **GIVEN** two `post_questions` calls overlap in time for `game: "main"`, the first posting `Q_A` and the second posting `Q_B`
- **WHEN** both calls complete
- **THEN** `Q_A`'s record is stamped with the `ts` and `permalink` of the message posted by the first call
- **AND** `Q_B`'s record is stamped with the `ts` and `permalink` of the message posted by the second call
- **AND** neither record carries the other's `ts` or `permalink`

#### Scenario: Repeated call with the same item set is a no-op

- **GIVEN** a successful `post_questions({ game: "main", items: [{ questionId: "Q1", blocks }] })` call has completed
- **WHEN** the same call is repeated
- **THEN** no new Slack message is posted
- **AND** the question record's `postedAt` and `messageLink` are unchanged
- **AND** `results[0]` reports `ok: true` with the prior `ts` and `permalink`

### Requirement: post_questions Stamps Atomically Before Reacting

For each item, the question record's `postedAt` and `messageLink` SHALL be written to disk BEFORE the reactions are added to the posted message. A reaction-add failure SHALL NOT undo the stamp; reactions are best-effort (consistent with the existing `addDeliveryReactions` contract).

#### Scenario: Stamp persists even when reaction-add fails

- **GIVEN** Slack `chat.postMessage` succeeds and `chat.getPermalink` succeeds
- **AND** the subsequent `reactions.add` call fails with a non-`already_reacted` error
- **WHEN** `post_questions` returns
- **THEN** the question record on disk is stamped with `postedAt` and `messageLink`
- **AND** `results[<item>].ok` is `true` (the stamping succeeded; reactions are best-effort and logged as warnings)
