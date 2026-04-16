## ADDED Requirements

### Requirement: post_top_level Flag on submit_response

The `submit_response` tool SHALL accept an optional `post_top_level: boolean` field when the session's trigger type supports channel-top-level delivery. When set to `true`, the response is delivered as a top-level channel message (no `thread_ts`) instead of a thread reply, and any pre-existing thinking indicator in the thread is removed.

#### Scenario: post_top_level field is exposed for supported triggers

- **WHEN** the `submit_response` tool schema is constructed for a session whose trigger type is `autoRespond`, `threadReply`, `mentions`, or `reactions`
- **THEN** the `post_top_level` field is included in the schema
- **AND** its description names canonical use cases (auto-respond rules that direct to the channel, announcement-style broadcasts)

#### Scenario: post_top_level field is omitted for triggers without channel top-level

- **WHEN** the trigger type is `directMessages`, `scheduled`, or the Changes Workflow worker mode
- **THEN** the `post_top_level` field is NOT included in the schema
- **AND** Claude cannot set it

#### Scenario: post_top_level: true routes delivery to channel top-level

- **GIVEN** a session with a supported trigger type and a streamer posting a thinking indicator in the thread
- **WHEN** Claude calls `submit_response` with `post_top_level: true` and a normal response
- **THEN** the deliver callback receives `postTopLevel: true`
- **AND** the streamer's in-thread message is deleted before the final post
- **AND** the response is posted to the session's channel via `chat.postMessage` without a `thread_ts`
- **AND** the tool's success result includes `postedTopLevel: true`

#### Scenario: post_top_level: false or unset preserves thread delivery

- **WHEN** Claude calls `submit_response` without `post_top_level` (or with `post_top_level: false`)
- **THEN** the deliver callback is called without the `postTopLevel` flag (or with it undefined)
- **AND** the response is finalized in the thread via the streamer, as before

### Requirement: Duplicate Post_to Rejection When post_top_level Is Set

The `submit_response` tool SHALL reject a response that sets `post_top_level: true` and also includes a `post_to` action targeting the session's channel without a `thread_ts` — that combination would duplicate the primary delivery. The existing `topLevelDeliveryChannel` validation is extended to recognize the session's channel as the effective top-level target when `post_top_level: true`.

#### Scenario: post_to targeting the same channel without thread_ts is rejected

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_SESSION"` and no `thread_ts`
- **THEN** the tool returns an error indicating the `post_to` would duplicate the top-level post
- **AND** does NOT call the deliver callback
- **AND** does NOT record the response as delivered

#### Scenario: post_to targeting a DIFFERENT channel is allowed

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_OTHER"` and no `thread_ts`
- **THEN** the tool accepts the response
- **AND** delivers the primary response to `C_SESSION` top-level
- **AND** the `post_to` is rendered as a button/auto action for `C_OTHER`

#### Scenario: post_to targeting the same channel WITH thread_ts is allowed

- **GIVEN** a session whose channel is `C_SESSION`
- **WHEN** Claude calls `submit_response` with `post_top_level: true` AND a `post_to` action with `channel: "C_SESSION"` and `thread_ts: "1234.5678"`
- **THEN** the tool accepts the response
- **AND** the `post_to` is not treated as a duplicate (different destination: a specific thread vs channel top-level)

### Requirement: DeliverFn Supports postTopLevel Routing

The `DeliverFn` type SHALL accept an optional `postTopLevel` boolean. When `true`, the implementation SHALL delete the streamer's in-thread message (if any) and post via `chat.postMessage` without a `thread_ts`. When `false` or absent, behavior matches the prior thread-reply delivery.

#### Scenario: postTopLevel routes via chat.postMessage without thread_ts

- **WHEN** the deliver callback is invoked with `postTopLevel: true`
- **THEN** the implementation calls `client.chat.postMessage` with the session's `channel` and without `thread_ts`
- **AND** the streamer (if present) is stopped and its message is deleted before the post

#### Scenario: postTopLevel delivery failure surfaces to the caller

- **WHEN** `chat.postMessage` throws during a top-level post
- **THEN** the deliver callback returns `{ ok: false, error }` with the error message
- **AND** the caller (submit_response) returns a `delivery_failed` tool error to Claude
