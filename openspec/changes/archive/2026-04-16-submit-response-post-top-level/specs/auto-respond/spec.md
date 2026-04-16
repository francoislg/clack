## ADDED Requirements

### Requirement: Direct-to-Channel Delivery via post_top_level

When an auto-respond rule's `extraContext` (or the channel's implicit convention) calls for the response to be posted at channel top-level rather than in the triggering thread, the system SHALL provide a structured signal — the `post_top_level: true` flag on `submit_response` — so Claude can route delivery without relying on `post_to` workarounds that risk duplication.

#### Scenario: Rule's extra context directs post to channel

- **GIVEN** an auto-respond rule whose `extraContext` instructs Claude to post directly to the channel rather than in the thread
- **WHEN** Claude handles a matching message and prepares a response
- **THEN** the delivery-context prompt for that session documents `post_top_level: true` as the correct mechanism
- **AND** instructs Claude NOT to combine it with a `post_to` action targeting the same channel (would duplicate)

#### Scenario: No duplicate messages when post_top_level is used correctly

- **GIVEN** Claude sets `post_top_level: true` on a response in an auto-respond session
- **WHEN** the tool delivers the response
- **THEN** exactly one message appears in Slack — a top-level post in the session's channel
- **AND** no thread-reply copy of the same content is posted

#### Scenario: post_to still available for cross-channel broadcasts

- **WHEN** Claude needs to post to a DIFFERENT channel (or a specific thread elsewhere) in addition to or instead of replying
- **THEN** Claude uses `post_to` with an explicit `channel` (and optionally `thread_ts`) — unaffected by `post_top_level`
- **AND** the two mechanisms compose: `post_top_level: true` delivers the primary response to the session's channel top-level while `post_to` can broadcast to other destinations

### Requirement: Follow-Up Session for Top-Level Posts

When a response is delivered top-level via `post_top_level: true`, the system SHALL create a new session tied to the posted message's thread so replies route to their own conversational context. The follow-up session inherits "similar context" from the parent session (channel, channelName, `additionalSystemPrompt`, user identity) but has its own independent lifecycle — its own `autoResponseActive` state, its own pre-analysis history, its own disengage decisions.

#### Scenario: Top-level delivery creates a new session for its own thread

- **GIVEN** an auto-respond session for channel C001 / thread T_original with `additionalSystemPrompt` carrying the rule's extra context
- **WHEN** Claude calls `submit_response` with `post_top_level: true` and the deliver callback posts successfully, returning ts T_new
- **THEN** a new session is created with `channelId: C001`, `threadTs: T_new`, `messageTs: T_new`, `triggerType: "autoRespond"`
- **AND** the new session's `additionalSystemPrompt`, `channelName`, `userId`, `username`, `displayName` are copied from the parent session
- **AND** `autoResponseActive: true` (default for new sessions)

#### Scenario: Replies to the top-level post route to the follow-up session

- **GIVEN** a follow-up session exists for `(C001, T_new)`
- **WHEN** a user replies in the thread of the top-level post (thread_ts = T_new)
- **THEN** the thread-reply auto-respond path resolves the follow-up session via `findSessionByThread(C001, T_new)`
- **AND** pre-analysis + response handling proceed against the follow-up session — independent of the parent

#### Scenario: Disengaging one session does not affect the other

- **GIVEN** parent session and follow-up session both exist and both have `autoResponseActive: true`
- **WHEN** Claude disengages the follow-up session (e.g., via `disengage: true` on a reply to the top-level post)
- **THEN** the follow-up session's `autoResponseActive` becomes false
- **AND** the parent session's `autoResponseActive` is unchanged — replies in the parent thread still go through auto-respond

#### Scenario: Follow-up session creation failure does not block delivery

- **GIVEN** `chat.postMessage` succeeds but `createSession` throws (e.g., disk full)
- **WHEN** the deliver callback returns
- **THEN** it returns `{ ok: true, ts }` — delivery is not failed
- **AND** the error is logged at warn level
- **AND** Claude's response is still considered successful — follow-up tracking is best-effort
