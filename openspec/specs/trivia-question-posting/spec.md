# trivia-question-posting Specification

## Purpose

The trivia plugin provides an MCP tool to post curated questions to Slack channels, stamp metadata (timestamp, permalink) back to the question record, and attach vote reactions. This capability is invoked by the scheduled question-posting run as the final step after Claude validates and formats a new question.

## Requirements

### Requirement: Question-cron prompt routing splits on prepCron

The question-cron spec emitted by `buildGameSpecs` SHALL select its prompt based on whether `game.prepCron` is set:

- When `game.prepCron` is SET, the question-cron spec's `prompt` SHALL be derived from `POST_QUESTIONS_INSTRUCTIONS` (the new prompt with the staged-pool check + inline-gen fallback + posting).
- When `game.prepCron` is ABSENT, the question-cron spec's `prompt` SHALL be derived from `SEND_QUESTIONS_INSTRUCTIONS` (the legacy gen-and-post prompt — observable behavior unchanged from before this change).

Internally, all three prompts (`SEND_`, `PREP_`, `POST_`) SHALL be composed from shared building-block constants (`PER_SLOT_GENERATION_PATHS`, `FORMAT_AND_POST_SECTION`, `CONTEXT_PRIORITY_PREAMBLE`) so that future changes to the per-slot generation flow or the posting/opener logic propagate to all three prompts automatically.

#### Scenario: Game without prepCron uses the legacy SEND prompt

- **GIVEN** a game with no `prepCron` field
- **WHEN** `buildGameSpecs` emits the question-cron spec
- **THEN** the spec's `prompt` is the legacy `SEND_QUESTIONS_INSTRUCTIONS` (with `{game}` substituted)
- **AND** the prompt does NOT contain a STAGED POOL CHECK section

#### Scenario: Game with prepCron uses the new POST prompt

- **GIVEN** a game with `prepCron` set
- **WHEN** `buildGameSpecs` emits the question-cron spec
- **THEN** the spec's `prompt` is `POST_QUESTIONS_INSTRUCTIONS` (with `{game}` substituted)
- **AND** the prompt contains a STAGED POOL CHECK section

### Requirement: POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating

The POST_QUESTIONS_INSTRUCTIONS prompt (used by the question cron when `game.prepCron` is set) SHALL begin with a staged-pool check before any per-slot generation:

1. Call `find_previous_questions({ games: ["<game>"], seasons: ["current"], posted: false, match: "all" })` to retrieve any staged questions.
2. Inspect the active format (slot count and per-slot labels) via a `get_ideas({ slot: 0 })` call.
3. For each slot index in `[0..slotCount-1]`:
   - If at least one staged question matches `slot.index === i`, select the oldest by `createdAt`.
   - If no staged question matches, run the per-slot generation flow inline (FACT/CHOICE/TOPICAL/FREEFORM matrix as rolled by `get_ideas` for that slot) and persist via `save_question`.
4. Once every slot has a question (staged or freshly generated), assemble the message blocks (opener if first-fire-of-season, per-question card built from question data + persona-driven flair, closer) and call `post_questions({ items })`.

When `prepCron` is configured but prep didn't run (or partially ran), the staged pool returns fewer questions than the format's slot count and the inline-gen branch covers the missing slots. When `prepCron` is NOT configured, the game uses the legacy `SEND_QUESTIONS_INSTRUCTIONS` prompt directly — see the routing requirement above.

#### Scenario: Question cron with complete staged pool

- **GIVEN** the staged pool contains questions for slots 0, 1, 2 of a 3-slot format
- **WHEN** the question cron fires and Claude runs the POST prompt
- **THEN** Claude reads the staged pool and finds all 3 slots filled
- **AND** Claude calls `save_question` zero times (no inline gen needed)
- **AND** Claude assembles the message blocks from the staged questions' data
- **AND** Claude calls `post_questions({ items: [item0, item1, item2] })` with items in slot order

#### Scenario: Question cron with partial staged pool

- **GIVEN** the staged pool contains questions for slots 0 and 2 (slot 1 missing)
- **AND** the active format has 3 slots
- **WHEN** the question cron fires
- **THEN** Claude reads the pool and identifies slot 1 as missing
- **AND** Claude calls `get_ideas({ slot: 1 })` and runs the full per-slot generation flow for slot 1
- **AND** Claude calls `save_question` for the new slot 1 question
- **AND** Claude calls `post_questions({ items: [staged-0, fresh-1, staged-2] })` with all three items in slot order

#### Scenario: Question cron with empty staged pool (prep configured but didn't run)

- **GIVEN** `game.prepCron` is set
- **AND** the staged pool is empty (prep failed earlier, or this is the very first fire)
- **WHEN** the question cron fires running POST_QUESTIONS_INSTRUCTIONS
- **THEN** Claude reads zero staged questions from the pool
- **AND** Claude inline-generates every slot in the format
- **AND** Claude calls `post_questions` with one item per slot

### Requirement: Per-question card blocks rebuild from question data at post time

For each question being posted (whether staged or freshly inline-generated), the POST prompt SHALL build the standard FOUR-BLOCK per-question card layout from the question record's stored fields — `category`, `statement`, `emojis`, plus the answer-format-specific fields (`isTrue` / `choices` / `correctIndex` / `expectedAnswer`). The block-rendering logic SHALL be identical for staged and inline-generated questions; the only difference is the source of the underlying data.

#### Scenario: Staged question renders identically to a freshly-generated one

- **GIVEN** a staged question with `{ category: "Geography", statement: "Foo is the capital of bar.", isTrue: true, emojis: ["🌍"], answersFormat: "boolean" }`
- **WHEN** Claude renders the FOUR-BLOCK card for this question at post time
- **THEN** the rendered blocks are structurally identical to those that would be rendered for the same question if generated inline at the same fire
- **AND** the persona-driven flair (header text variation, warm-up patter, closer) reflects the same constraints documented in the question-posting prompt today

### Requirement: post_questions MCP Tool

The trivia plugin SHALL register an MCP tool named `post_questions` (admin role) that accepts a game name and an array of items — each item carrying a `questionId` and a `blocks` payload — and, for each item, posts the question to the game's configured Slack channel, retrieves the message's permalink, stamps `postedAt`, `messageLink`, and `liveAnswersVisible` on the question record, and appends an answer-buttons `actions` block sized to the question's `answersFormat`.

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

For each item, the tool SHALL append an `actions` block to the END of the item's `blocks` array (after Claude's authored content), sized and labeled per the question's stored `answersFormat`:

- `answersFormat === "boolean"` (or absent): two buttons, `{ text: "👍 TRUE", action_id: "plugin:trivia:vote:<questionId>:true", style: "primary" }` and `{ text: "👎 FALSE", action_id: "plugin:trivia:vote:<questionId>:false" }`, in that order.
- `answersFormat === "choice"`: 2–4 buttons sized to `question.choices.length`. Button `i` (0-indexed) SHALL have `text: "<numbered-emoji> <choices[i]>"` (numbered emoji is `1️⃣`, `2️⃣`, `3️⃣`, `4️⃣` for indices 0–3 respectively) and `action_id: "plugin:trivia:vote:<questionId>:<i>"`.
- `answersFormat === "freeform"`: one button, `{ text: "Answer", action_id: "plugin:trivia:freeform-answer:<questionId>", style: "primary" }`.

The tool SHALL NOT attach any reactions to the posted message. Vote reactions (`+1`/`-1`, `one`/`two`/`three`/`four`) SHALL NEVER be auto-attached. Users may still react manually; those reactions are consumed at reveal time as commentary only (see `trivia-reveal-processor`).

The tool SHALL NOT accept a `reactions` argument.

For each item, the tool SHALL resolve `liveAnswersVisible` from the cascade `slot.liveAnswersVisible → season.liveAnswersVisible → game.liveAnswersVisible → config.trivia.liveAnswersVisible → true (default)` and SHALL stamp the resolved boolean onto the question record alongside `postedAt`, `messageLink`, and `batchId`. The stamp SHALL happen in the same atomic `updateQuestion` write. Subsequent roster-footer rebuilds SHALL read this stamped value, not re-resolve the cascade.

For each item, the tool SHALL ALSO resolve `revealResponses` from the cascade `slot.revealResponses → season.revealResponses → game.revealResponses → config.trivia.revealResponses → "yes" (default)` and SHALL stamp the resolved value (`"no"` | `"just-correctness"` | `"yes"`) onto the question record in the same atomic `updateQuestion` write. Subsequent reveal-payload assembly inside `process_reveal_answers` SHALL read this stamped value, not re-resolve the cascade.

The tool SHALL stamp the full `blocks` array (with the appended `actions` block) onto the question record as `postedBlocks`, so that subsequent roster-footer rebuilds via `chat.update` can compose `[...postedBlocks, ...rosterBlocks]` from a stable base.

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

#### Scenario: Boolean question gets vote buttons, no reactions

- **GIVEN** `games/main/questions.json` contains `Q1` with `answersFormat: "boolean"` and no `postedAt`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q1", blocks: <valid> }] })` is called
- **THEN** the posted message includes an `actions` block as its final block with TWO buttons: `{ text: "👍 TRUE", action_id: "plugin:trivia:vote:Q1:true", style: "primary" }` followed by `{ text: "👎 FALSE", action_id: "plugin:trivia:vote:Q1:false" }`
- **AND** NO reactions are attached to the message
- **AND** the question record is stamped with `postedAt`, `messageLink`, `batchId`, `postedBlocks`, and `liveAnswersVisible`

#### Scenario: 4-choice question gets numbered-emoji buttons sized to choices

- **GIVEN** `games/main/questions.json` contains `Q2` with `answersFormat: "choice"` and `choices: ["The Beatles", "Led Zeppelin", "Cream", "The Who"]`
- **WHEN** `post_questions({ game: "main", items: [{ questionId: "Q2", blocks: <valid> }] })` is called
- **THEN** the posted message's final block is an `actions` block with FOUR buttons in order:
  - `{ text: "1️⃣ The Beatles", action_id: "plugin:trivia:vote:Q2:0" }`
  - `{ text: "2️⃣ Led Zeppelin", action_id: "plugin:trivia:vote:Q2:1" }`
  - `{ text: "3️⃣ Cream", action_id: "plugin:trivia:vote:Q2:2" }`
  - `{ text: "4️⃣ The Who", action_id: "plugin:trivia:vote:Q2:3" }`
- **AND** NO reactions are attached

#### Scenario: 3-choice question sizes buttons correctly

- **GIVEN** `Q3` with `answersFormat: "choice"` and `choices: ["A", "B", "C"]`
- **WHEN** `post_questions` posts `Q3`
- **THEN** the actions block contains exactly THREE buttons with action_ids `plugin:trivia:vote:Q3:0`, `plugin:trivia:vote:Q3:1`, `plugin:trivia:vote:Q3:2`

#### Scenario: Freeform question keeps its Answer button, no reactions

- **GIVEN** `Q4` with `answersFormat: "freeform"`
- **WHEN** `post_questions` posts `Q4`
- **THEN** the actions block contains one `{ text: "Answer", action_id: "plugin:trivia:freeform-answer:Q4", style: "primary" }` button
- **AND** NO reactions are attached

#### Scenario: liveAnswersVisible cascade resolved at post time

- **GIVEN** `config.trivia.liveAnswersVisible: true`, no game / season / slot override, and `Q1` belongs to the active batch
- **WHEN** `post_questions` posts `Q1`
- **THEN** the question record is updated with `liveAnswersVisible: true`

#### Scenario: liveAnswersVisible game-level override is honored

- **GIVEN** `config.trivia.liveAnswersVisible: true` and the game's config has `liveAnswersVisible: false`
- **WHEN** `post_questions` posts a question for that game
- **THEN** the question record is stamped `liveAnswersVisible: false`

#### Scenario: liveAnswersVisible slot-level override beats season and game

- **GIVEN** `config.trivia.liveAnswersVisible: true`, season override `false`, game override `true`, and the slot the question is being posted into has `liveAnswersVisible: false`
- **WHEN** `post_questions` posts the question
- **THEN** the question record is stamped `liveAnswersVisible: false` (slot wins the cascade)

#### Scenario: liveAnswersVisible defaults to true when nothing overrides

- **GIVEN** no `liveAnswersVisible` value is set at slot, season, game, or workspace config
- **WHEN** `post_questions` posts a question
- **THEN** the question record is stamped `liveAnswersVisible: true`

#### Scenario: Stamped value isolates against mid-round config edits

- **GIVEN** `Q1` was posted with stamped `liveAnswersVisible: true`
- **AND** an admin updates `config.trivia.liveAnswersVisible` to `false` AFTER the post
- **WHEN** a new answerer clicks a vote button on `Q1` and the roster footer rebuilds
- **THEN** the footer renders in the visible-answers layout (per the stamped `true`), NOT the hidden layout

#### Scenario: revealResponses cascade resolved at post time

- **GIVEN** `config.trivia.revealResponses: "yes"`, no game / season / slot override, and `Q1` belongs to the active batch
- **WHEN** `post_questions` posts `Q1`
- **THEN** the question record is updated with `revealResponses: "yes"`

#### Scenario: revealResponses game-level override is honored

- **GIVEN** `config.trivia.revealResponses: "yes"` and the game's config has `revealResponses: "just-correctness"`
- **WHEN** `post_questions` posts a question for that game
- **THEN** the question record is stamped `revealResponses: "just-correctness"`

#### Scenario: revealResponses slot-level override beats season and game

- **GIVEN** `config.trivia.revealResponses: "yes"`, season override `"just-correctness"`, game override `"yes"`, and the slot has `revealResponses: "no"`
- **WHEN** `post_questions` posts the question
- **THEN** the question record is stamped `revealResponses: "no"` (slot wins the cascade)

#### Scenario: revealResponses defaults to "yes" when nothing overrides

- **GIVEN** no `revealResponses` value is set at slot, season, game, or workspace config
- **WHEN** `post_questions` posts a question
- **THEN** the question record is stamped `revealResponses: "yes"`

#### Scenario: revealResponses stamped value isolates against mid-round config edits

- **GIVEN** `Q1` was posted with stamped `revealResponses: "no"`
- **AND** an admin updates `config.trivia.revealResponses` to `"yes"` AFTER the post
- **WHEN** `process_reveal_answers` runs for `Q1`'s batch
- **THEN** the reveal payload's `voters` for `Q1` carries `revealResponses: "no"` (per the stamped value), NOT the new live-config value

#### Scenario: postedBlocks is stamped for all formats

- **GIVEN** a question of any `answersFormat` is being posted
- **WHEN** `post_questions` completes the post
- **THEN** `question.postedBlocks` is set to the full Block Kit array (including the appended `actions` block)
- **AND** subsequent `chat.update` calls for the roster footer can compose against this base

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


