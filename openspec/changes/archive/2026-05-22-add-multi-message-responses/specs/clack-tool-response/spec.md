## ADDED Requirements

### Requirement: Multi-Message Top-Level (Gated)

The `submit_response` tool SHALL expose two optional sibling fields, `additional_messages` and `thread_replies`, on the top-level schema ONLY when the session's `SubmitResponseDeps.allowMultiMessage === true`. When the flag is unset or false, the fields SHALL NOT appear in the schema at all (not as optional fields rejected at validation — absent from the schema). The scheduled (cron) trigger handler SHALL set `allowMultiMessage: true`. All other trigger handlers (DM, @mention, reaction, Changes Workflow worker mode) SHALL leave the flag unset.

#### Scenario: Scheduled trigger exposes both fields

- **GIVEN** a `submit_response` tool built from deps with `allowMultiMessage: true` (scheduled trigger)
- **WHEN** the tool's input schema is inspected
- **THEN** the schema contains both `additional_messages` and `thread_replies` as optional fields
- **AND** their descriptions name the publishing-mode use cases

#### Scenario: Non-scheduled trigger omits both fields

- **WHEN** the tool schema is built for a DM, @mention, reaction, or auto-respond trigger (`allowMultiMessage` unset or false)
- **THEN** neither `additional_messages` nor `thread_replies` is present in the schema
- **AND** a call that attempts to set either field is rejected by zod with a "unrecognized key" error before any custom validation runs

#### Scenario: Worker mode omits both fields

- **WHEN** the Changes Workflow worker mode builds its tool schema
- **THEN** neither field is present (worker mode never sets `allowMultiMessage: true`)

### Requirement: Multi-Message Inside post_to

The `post_to` action SHALL accept the same `additional_messages` and `thread_replies` optional fields with the same shape, caps, and mutual-exclusivity rule as the top-level fields. These fields SHALL be available on `post_to` regardless of the top-level `allowMultiMessage` flag — creating a `post_to` is itself the explicit opt-in to publishing-mode delivery.

#### Scenario: post_to in any trigger context can carry followers

- **GIVEN** a session with `allowMultiMessage` unset (e.g., a DM)
- **WHEN** Claude calls `submit_response` with a `post_to` action that includes `additional_messages: [...]`
- **THEN** the schema accepts the `additional_messages` inside `post_to` even though it is hidden from the top level
- **AND** validation, snapshot persistence, and delivery proceed for the post_to batch

#### Scenario: post_to with thread_replies requires its own thread_ts to be absent

- **WHEN** Claude calls a `post_to` action with `thread_replies` AND `thread_ts` set on the same action
- **THEN** the tool returns a batch validation error explaining that `thread_replies` requires the post_to to land top-level (no `thread_ts`), because `thread_replies` are posted under the post_to's own message timestamp
- **AND** the error path identifies the offending action index

#### Scenario: post_to with additional_messages requires thread_ts to be present OR primary thread context

- **WHEN** Claude calls a `post_to` action with `additional_messages` AND no `thread_ts` AND the post_to is targeting a top-level channel slot
- **THEN** the tool returns a batch validation error — `additional_messages` are siblings, requiring a thread context to share
- **AND** the error path identifies the offending action index

### Requirement: Mode-Exclusive Multi-Message Fields

At the top level of `submit_response`, `additional_messages` SHALL be valid only when `post_top_level` is unset or `false`, and `thread_replies` SHALL be valid only when `post_top_level === true`. The other combinations SHALL be rejected as part of the batch validation pass.

#### Scenario: additional_messages with post_top_level: true is rejected

- **WHEN** Claude calls `submit_response` with `additional_messages: [...]` AND `post_top_level: true`
- **THEN** the batch validation rejects with an error stating `additional_messages` cannot be combined with `post_top_level: true` (use `thread_replies` instead)
- **AND** delivery is NOT attempted

#### Scenario: thread_replies without post_top_level is rejected

- **WHEN** Claude calls `submit_response` with `thread_replies: [...]` AND `post_top_level` unset or `false`
- **THEN** the batch validation rejects with an error stating `thread_replies` requires `post_top_level: true` (the primary must be a new top-level post for replies to thread under it; use `additional_messages` for sibling messages in the current thread)
- **AND** delivery is NOT attempted

#### Scenario: additional_messages with post_top_level unset is accepted

- **WHEN** Claude calls `submit_response` with `additional_messages: [...]` and no `post_top_level`
- **THEN** the mode-exclusive check passes
- **AND** validation proceeds to the per-message gates

#### Scenario: thread_replies with post_top_level: true is accepted

- **WHEN** Claude calls `submit_response` with `thread_replies: [...]` and `post_top_level: true`
- **THEN** the mode-exclusive check passes
- **AND** validation proceeds to the per-message gates

### Requirement: Configurable additional_messages Cap

The system SHALL accept an optional `submitResponse.maxAdditionalMessages: number` field in `config.json`, default `5`, validated at boot to integer range `[1, 10]` inclusive. The validated value SHALL be threaded through `QueryToolContext` and `SubmitResponseDeps` and used as the upper bound on the length of any `additional_messages` array — at the top level (when allowed) and inside every `post_to` action.

#### Scenario: Config absent defaults to 5

- **WHEN** `config.json` has no `submitResponse` section, OR has `submitResponse: {}` without `maxAdditionalMessages`
- **THEN** the parsed config carries `maxAdditionalMessages: 5`
- **AND** the field flows through to `SubmitResponseDeps.maxAdditionalMessages`

#### Scenario: Config value within range is accepted

- **WHEN** `config.json` has `submitResponse: { maxAdditionalMessages: 3 }`
- **THEN** `loadConfig` accepts the value
- **AND** the schema cap on `additional_messages` becomes 3 at every layer

#### Scenario: Config value below range is rejected at boot

- **WHEN** `config.json` has `submitResponse: { maxAdditionalMessages: 0 }`
- **THEN** `loadConfig` throws an error identifying the path and the valid range `[1, 10]`

#### Scenario: Config value above range is rejected at boot

- **WHEN** `config.json` has `submitResponse: { maxAdditionalMessages: 11 }`
- **THEN** `loadConfig` throws an error identifying the path and the valid range `[1, 10]`

#### Scenario: Non-integer config value is rejected

- **WHEN** `config.json` has `submitResponse: { maxAdditionalMessages: 4.5 }`
- **THEN** `loadConfig` throws an error stating the value must be an integer

#### Scenario: additional_messages exceeding configured cap is rejected

- **GIVEN** `maxAdditionalMessages: 3`
- **WHEN** Claude calls `submit_response` with `additional_messages` of length 4
- **THEN** the batch validation rejects with an error naming the actual length, the cap, and the config path `submitResponse.maxAdditionalMessages`
- **AND** delivery is NOT attempted

#### Scenario: post_to.additional_messages uses the same configured cap

- **GIVEN** `maxAdditionalMessages: 3`
- **WHEN** Claude calls `submit_response` with a `post_to` action whose `additional_messages` has length 5
- **THEN** the batch validation rejects with an error naming the action index, the actual length, and the same cap

### Requirement: thread_replies Sanity Ceiling

The number of entries in any `thread_replies` array — at the top level (when allowed) and inside `post_to` actions — SHALL be bounded by a fixed sanity ceiling of `20`. This ceiling is NOT configurable and is enforced at the schema level (via `z.array(...).max(20)`).

#### Scenario: thread_replies up to 20 entries is accepted

- **WHEN** Claude calls `submit_response` (or a `post_to`) with `thread_replies` of length 20
- **THEN** the schema parse succeeds
- **AND** the batch validation proceeds (other gates may still reject for other reasons)

#### Scenario: thread_replies exceeding 20 entries is rejected

- **WHEN** Claude calls `submit_response` (or a `post_to`) with `thread_replies` of length 21
- **THEN** the schema parse rejects with the standard zod "array too long" error naming the field path and the 20-entry maximum
- **AND** delivery is NOT attempted

### Requirement: Per-Message Payload Shape

Each entry in `additional_messages`, `thread_replies`, `post_to.additional_messages`, and `post_to.thread_replies` SHALL be a `MessagePayload` object with the following shape: `blocks: Block[]` (required, at least one), `table?: TableBlock`, `actions?: Action[]`, `reactions?: string[]`. The fields `message`, `post_top_level`, `disengage`, and `skip_response` SHALL NOT be present on `MessagePayload` — they are session-level signals carried only on the primary `submit_response` payload.

#### Scenario: MessagePayload accepts blocks plus optional fields

- **WHEN** an `additional_messages[i]` entry has `{ blocks, table, actions, reactions }`
- **THEN** the schema accepts the entry
- **AND** each optional field is validated by the same validators that handle the corresponding primary-level field

#### Scenario: MessagePayload rejects primary-only fields

- **WHEN** an `additional_messages[i]` entry includes `message`, `post_top_level`, `disengage`, or `skip_response`
- **THEN** zod rejects with an "unrecognized key" error naming the offending field and the entry index

#### Scenario: MessagePayload requires non-empty blocks

- **WHEN** an `additional_messages[i]` entry has `blocks: []`
- **THEN** zod rejects with the standard "array too short" error naming the field path and the minimum of 1

### Requirement: Atomic Batch Validation With Aggregated Errors

The `submit_response` tool SHALL validate every gate across the whole batch — primary, every `additional_messages` entry, every `thread_replies` entry, every `post_to` and its own `additional_messages` / `thread_replies` entries — collecting ALL errors before deciding to deliver. If any error exists in any message, the entire batch SHALL be refused with a single error result of the form `{ error: "invalid_batch", details: string[] }` where each entry in `details` carries a path identifying the offending location (e.g., `additional_messages[1].blocks[0].text`). No partial delivery SHALL occur.

#### Scenario: All-valid batch passes validation

- **WHEN** every block, table, label, ref, intent-coverage, and length gate passes across the primary and all followers
- **THEN** validation produces no errors
- **AND** the tool proceeds to sequential delivery

#### Scenario: Single error in primary refuses whole batch

- **WHEN** the primary has a 200-char `header.text` (exceeds 150-char limit) and all followers are valid
- **THEN** the tool returns `{ error: "invalid_batch", details: [...] }` containing the primary's error
- **AND** does NOT call `deliver` for any message

#### Scenario: Single error in a follower refuses whole batch

- **WHEN** the primary is valid but `additional_messages[1]` has an invalid block
- **THEN** the tool returns `invalid_batch` with the error pathed to `additional_messages[1]`
- **AND** delivery is NOT attempted for any message

#### Scenario: Multiple errors across batch returned together

- **WHEN** the primary has an oversize header AND `additional_messages[0]` has an invalid block AND `thread_replies[2].actions[0].ref` is unknown AND a `post_to` action's `blocks[0]` is malformed
- **THEN** the `details` array contains a separate entry for EACH error, each with its own path
- **AND** no partial delivery occurs
- **AND** Claude can fix all issues in a single retry

#### Scenario: Ref-coverage walks the full batch

- **GIVEN** Claude staged a `propose_change` intent (ref X) earlier in the run
- **WHEN** Claude places the change action inside `thread_replies[0].actions[1]` and nowhere else
- **THEN** `validateStagedIntentsCoverage` accepts the response (the intent is covered by a thread reply)
- **AND** delivery proceeds

#### Scenario: post_to duplicate-channel guard sees the full batch

- **WHEN** Claude calls `submit_response` with `post_top_level: true` (delivering primary to channel `C_SESSION`) AND a `post_to` action with `channel: "C_SESSION"` and no `thread_ts` is placed inside `thread_replies[0].actions[0]`
- **THEN** `validatePostToActions` walks all batch levels and detects the duplicate
- **AND** returns an error pathed to `thread_replies[0].actions[0]`

#### Scenario: Length limit applies per message

- **GIVEN** the 10,000-char Slack message text limit
- **WHEN** the primary's displayed text is 9,500 chars AND `additional_messages[0]`'s displayed text is also 9,500 chars
- **THEN** both messages independently pass the length gate
- **AND** the sum is NOT checked against the limit (each Slack message gets its own budget)

### Requirement: Sequential Batch Delivery

After all validation passes, the tool SHALL deliver messages sequentially in the order: primary first, then each `additional_messages[i]` in order, then each `thread_replies[i]` in order. The streamer-cleanup (deleting the thinking indicator) SHALL occur exactly once, before the primary delivery. Each follower message SHALL be delivered via the same `DeliverFn` with an explicit `threadTs` parameter — for `additional_messages`, the existing thread's `ts`; for `thread_replies`, the primary's returned `ts`. If a mid-batch Slack delivery fails, the tool SHALL return `{ error: "delivery_failed", details: ... }` to Claude noting which message index failed and stop the batch — already-posted messages remain (no rollback).

#### Scenario: Primary delivered with streamer cleanup, followers without

- **GIVEN** a thinking-indicator streamer is active in the thread
- **WHEN** the tool delivers a batch of primary + 2 `additional_messages`
- **THEN** the streamer is deleted exactly once (before primary)
- **AND** the primary is posted via `chat.postMessage` (or `chat.update`) at the streamer's position
- **AND** each follower is posted via `chat.postMessage` to the same thread without streamer interaction

#### Scenario: thread_replies use primary's ts as thread_ts

- **GIVEN** `post_top_level: true` and `thread_replies: [m1, m2]`
- **WHEN** the primary is delivered top-level and returns `ts: "1234.5678"`
- **THEN** `m1` is delivered with `threadTs: "1234.5678"`
- **AND** `m2` is delivered with `threadTs: "1234.5678"`

#### Scenario: additional_messages use the existing thread ts

- **GIVEN** the session is processing a thread reply (existing thread ts `9999.1111`) and Claude submits `additional_messages: [m1, m2]`
- **WHEN** the tool delivers the batch
- **THEN** the primary is delivered as a thread reply to `9999.1111`
- **AND** `m1` and `m2` are each delivered with `threadTs: "9999.1111"` (siblings in the same thread)

#### Scenario: Mid-batch delivery failure stops the batch

- **WHEN** the primary delivers successfully but the second `additional_messages` call returns `{ ok: false, error: "channel_archived" }`
- **THEN** the tool returns `{ error: "delivery_failed", details: "additional_messages[1]: channel_archived" }`
- **AND** does NOT attempt to deliver later messages in the batch
- **AND** does NOT attempt to delete the already-posted primary or `additional_messages[0]`
- **AND** `responseCapture` reflects the messages that DID post (Claude can recover on next turn)

#### Scenario: Success result reports delivered counts

- **WHEN** a batch of primary + 3 `additional_messages` delivers successfully
- **THEN** the tool's success result includes the total message count (`messagesDelivered: 4`) so Claude sees confirmation
- **AND** the result also includes the existing `blocksCount`/`actionsCount` for the primary

### Requirement: DeliverFn Accepts threadTs

The `DeliverFn` type SHALL accept an optional `threadTs?: string` parameter. When present, the implementation SHALL post via `chat.postMessage` with that `thread_ts` (and no streamer interaction — the streamer is consumed by the call that did not pass `threadTs`). When `threadTs` is absent and `postTopLevel: true`, the existing top-level-channel posting path applies. When neither is present, the existing thread-reply-via-streamer path applies.

#### Scenario: threadTs routes via chat.postMessage with thread_ts

- **WHEN** `deliver({ blocks, threadTs: "1234.5678" })` is called
- **THEN** the implementation calls `client.chat.postMessage` with the session's channel and `thread_ts: "1234.5678"`
- **AND** does NOT touch the streamer

#### Scenario: threadTs takes precedence over postTopLevel

- **WHEN** `deliver({ blocks, threadTs: "1234.5678", postTopLevel: true })` is called (unexpected combination, but defensive)
- **THEN** the implementation uses `threadTs` and ignores `postTopLevel` — a non-empty thread target wins

#### Scenario: Existing single-message callers unaffected

- **WHEN** a caller invokes `deliver({ blocks, reactions })` without `threadTs` or `postTopLevel`
- **THEN** the existing behavior (post via streamer or fallback to thread reply) applies unchanged

### Requirement: Snapshot Persistence Per post_to Captures Followers

When a `post_to` action carries `additional_messages` or `thread_replies`, the snapshot record persisted at submit time SHALL include those followers alongside the existing `text`/`blocks`/`table`/`actions`/`reactions` fields. The button-click delivery path SHALL replay the primary then the followers in sequence, using the same sequential-delivery rules as the top-level batch. One `post_to` action SHALL correspond to ONE snapshot ID — followers do not get their own snapshot IDs.

#### Scenario: Snapshot stores followers when present

- **WHEN** a `post_to` action with `additional_messages: [...]` is processed by `submit_response`
- **THEN** the persisted snapshot record contains the followers under the same shape (`additional_messages` field on the snapshot)
- **AND** one snapshot ID is generated for the action and stored on `action._snapshotId`

#### Scenario: Snapshot omits followers when absent

- **WHEN** a `post_to` action has no followers
- **THEN** the persisted snapshot record does NOT include empty `additional_messages` or `thread_replies` fields (no spurious empty arrays)

#### Scenario: Button-click replays primary then followers sequentially

- **GIVEN** a `post_to` snapshot persisted with `{ blocks, additional_messages: [m1, m2] }`
- **WHEN** the user clicks the post_to button
- **THEN** the handler loads the snapshot, posts the primary to the target channel via `chat.postMessage` (capturing the returned `ts`), then posts `m1` and `m2` with `thread_ts` equal to the primary's `ts` (when followers are `thread_replies`) or equal to the post_to's existing `thread_ts` (when followers are `additional_messages`)

#### Scenario: Nested post_to inside post_to followers is still rejected

- **WHEN** a `post_to` action's `additional_messages[0].actions[0]` is itself a `post_to`
- **THEN** the batch validator rejects with an error stating that nested `post_to` is not supported (the existing nested-post_to rule extends to walk inside post_to followers)
- **AND** the error path identifies the offending location

### Requirement: Session Persistence Records Batch

The session-persistence layer SHALL store the full batch of rendered blocks (primary plus all delivered followers) rather than just the primary. Loading an old session whose persisted shape predates this change SHALL deserialize cleanly as a single-element batch.

#### Scenario: New batch session persists all messages

- **WHEN** a session delivers a batch of primary + 2 followers
- **THEN** the persisted `renderedBlocks` field is an array of 3 entries (primary first, followers in order)
- **AND** each entry is the full SlackBlocks payload for that message

#### Scenario: Old single-message session loads unchanged

- **WHEN** an existing session file from before this change is loaded
- **THEN** the deserializer treats the legacy `renderedBlocks` shape as a single-element array
- **AND** the rest of session restoration proceeds unchanged

### Requirement: Tool Description Names Publishing Use Cases

The schema descriptions for `additional_messages` and `thread_replies` SHALL explicitly name the publishing-mode use cases (scheduled announcements with threaded detail, multi-part cron deliverables, multi-message cross-posts via `post_to`) and SHALL NOT describe them as generic message-splitting tools. The intent is that Claude reaches for these fields only when the deliverable's structure genuinely warrants multiple posts.

#### Scenario: additional_messages description names scheduled use case

- **WHEN** the schema for `additional_messages` is built (top-level or inside `post_to`)
- **THEN** the description references publishing/scheduled-announcement use cases and the cap (from config or from the 20-ceiling for thread_replies)
- **AND** does NOT suggest using it to split a long single-message response

#### Scenario: thread_replies description names announcement-thread use case

- **WHEN** the schema for `thread_replies` is built
- **THEN** the description names the "announcement at top of channel with details in the thread" pattern
- **AND** notes the `post_top_level: true` requirement (or `post_to`-without-`thread_ts` for the post_to surface)
