# ephemeral-channel-conversations Specification

## Purpose
Ephemeral channel-conversation windows: when Clack posts a top-level channel message, it can opt into temporarily following the conversation that post starts. A Clack-seeded, self-expiring auto-respond rule judges subsequent top-level messages for relatedness, continues the anchor session on genuine replies, decays on unrelated traffic, and is killable by stop emoji, Home Tab, or tool.
## Requirements

### Requirement: Ephemeral Rule Shape

The system SHALL represent a followed channel conversation as an auto-respond rule with `kind: "ephemeral"`, carrying `expiresAt` (epoch ms, sliding window end), `attentionLevel` (the live dial: `"high" | "medium" | "low"`), `sessionIds` (ordered conversation ledger, anchor first), `anchorText` (the seeding post's text, truncated to ~500 characters), and optionally `followUpContext` (guidance injected into responding turns). A rule without `kind` SHALL read as a standing rule.

#### Scenario: Ephemeral rule created by seeding
- **WHEN** a top-level post opts into channel following
- **THEN** an ephemeral rule exists for that channel with `sessionIds: [<seeding session id>]`, `anchorText` from the posted content, and `expiresAt` set to now + TTL

#### Scenario: Ledger capped
- **WHEN** appending a session ID would grow `sessionIds` beyond 10 entries
- **THEN** the oldest non-anchor entry is dropped
- **AND** the anchor entry (`sessionIds[0]`) is never dropped

### Requirement: Opt-In Seeding at Post Time

The system SHALL create an ephemeral rule only when Claude explicitly opts a top-level post in via the `channel_attention_level` field on the delivery surface (`post_to` action or `deliver_to` entry). Seedable levels are `"high" | "medium" | "low"`; `"always"` SHALL NOT be seedable. The initial TTL SHALL be 60 minutes.

#### Scenario: Absent field means no window
- **WHEN** Clack posts a top-level message without `channel_attention_level`
- **THEN** no ephemeral rule is created and behavior matches pre-change deployments

#### Scenario: Threaded destination ignores the field
- **WHEN** a `post_to` action carries `channel_attention_level` and a `thread_ts`
- **THEN** no ephemeral rule is created
- **AND** the tool result carries a non-fatal warning explaining the field only applies to top-level posts

#### Scenario: Newest-wins per channel
- **WHEN** a seeding post targets a channel that already has an ephemeral rule
- **THEN** the existing ephemeral rule is replaced by the new one
- **AND** at most one ephemeral rule exists per channel at any time

### Requirement: Channel Continuation Judge

The system SHALL evaluate every top-level message in a channel with an ephemeral rule through a channel-continuation pre-analysis variant that asks whether the message is part of the conversation the anchor post started, treating unrelatedness as the default prior. The judge SHALL receive the rule's `anchorText`, recent channel history (up to 10 messages preceding the evaluated one, mirroring the standing-rule gate's enrichment), the message author, and the elapsed time since the bot's last message in the channel, and SHALL return `respond`, `skip`, or `stop`, keyed by the rule's current `attentionLevel`.

#### Scenario: Judge runs even past expiry
- **WHEN** a top-level message arrives after the rule's `expiresAt` has passed
- **THEN** the judge still runs with the full elapsed-time signal
- **AND** a genuine continuation (e.g. a next-morning reply to an end-of-day post) can yield `respond`

#### Scenario: Anchor text grounds the judgment
- **WHEN** the judge evaluates a message
- **THEN** its prompt contains the anchor post's text verbatim so relatedness is judged against a concrete post, not just channel history

### Requirement: Event-Driven Lifecycle

The system SHALL manage the ephemeral rule's lifecycle entirely at message-trigger time, with no timers or background sweeps. Verdict handling SHALL be: `respond` → continue the conversation and renew `expiresAt` (sliding window); `skip` within the window → ratchet `attentionLevel` down one rung (`high → medium → low`), deleting the rule when already at `low`; `skip` past `expiresAt` → delete the rule; `stop` → delete the rule.

#### Scenario: Skip ratchets from high
- **WHEN** an unrelated top-level message arrives while the rule is within its window at `high`
- **THEN** the rule's `attentionLevel` becomes `medium`
- **AND** the rule is not deleted

#### Scenario: Skip ratchets within the window
- **WHEN** an unrelated top-level message arrives while the rule is within its window at `medium`
- **THEN** the rule's `attentionLevel` becomes `low`
- **AND** the rule is not deleted

#### Scenario: Ratchet below low deletes
- **WHEN** an unrelated top-level message arrives while the rule is at `low` within its window
- **THEN** the rule is deleted

#### Scenario: Dormant skip deletes
- **WHEN** an unrelated top-level message arrives past `expiresAt`
- **THEN** the rule is deleted without ratcheting

#### Scenario: Respond revives a dormant rule
- **WHEN** a related top-level message arrives past `expiresAt` and the judge returns `respond`
- **THEN** the conversation continues and `expiresAt` is renewed to now + TTL

#### Scenario: Silent channel costs nothing
- **WHEN** no messages arrive in a channel with a dormant ephemeral rule
- **THEN** the rule lingers inert with zero evaluation cost until a message arrives

### Requirement: Anchor Session Continuation

The system SHALL route a `respond` verdict as a continuation of the anchor session (`sessionIds[0]`): the turn resumes the session's SDK conversation and uses trigger type `"channelReply"`. Delivery follows the existing top-level-trigger machinery: a `post_top_level` response posts top-level in the channel (and, per the existing follow-up-session mechanism, seeds a thread session for replies under the new post), while the default delivery threads under the user's message; in both cases the newly seeded thread session joins the rule's ledger.

#### Scenario: Conversation memory persists
- **WHEN** a user replies top-level and the judge returns `respond`
- **THEN** the responding turn resumes the anchor session's `sdkSessionId` so Claude retains the conversation's prior context

#### Scenario: Trigger type recorded
- **WHEN** a channel continuation turn runs
- **THEN** the session records the turn with trigger type `"channelReply"`

#### Scenario: Tool availability follows the anchor session
- **WHEN** a channel continuation turn runs
- **THEN** its toolbelt and action gating are identical to a thread-reply follow-up turn on the same anchor session (no new tool surface is granted or removed by the `channelReply` trigger itself)

#### Scenario: SDK resume failure falls back gracefully
- **WHEN** the anchor session's SDK conversation cannot be resumed (e.g. expired or missing `sdkSessionId`)
- **THEN** the turn proceeds via the existing session-resume fallback (fresh SDK conversation seeded from the session record and channel context)
- **AND** the user's message is still answered rather than silently dropped

### Requirement: Conversation Ledger and Pull-Based Context

The system SHALL append to the rule's `sessionIds` every session that joins the conversation (thread spin-offs), and the responding turn's prompt SHALL state how many linked sessions exist and that `find_sessions` retrieves them. Linked-session content SHALL NOT be eagerly injected.

#### Scenario: Thread spin-off joins the ledger
- **WHEN** a channel continuation turn's delivery seeds a new thread-keyed follow-up session (threaded reply under the user's message, or the follow-up session under a `post_top_level` post)
- **THEN** that session's ID is appended to the rule's `sessionIds`

#### Scenario: Context on demand
- **WHEN** a channel continuation turn runs and the rule's ledger holds more than one session
- **THEN** the prompt tells Claude the linked sessions exist and are retrievable via `find_sessions`
- **AND** their content is not injected into the prompt

### Requirement: Per-Turn Placement and Thread Handoff

The responding turn SHALL be able to deliver top-level (continuing the channel conversation) or as a threaded reply. A threaded reply SHALL create a normal thread-keyed session owned by the existing thread-engagement system, and prompt guidance SHALL steer quick conversational beats top-level and substantive follow-ups into threads.

#### Scenario: Thread handoff
- **WHEN** Claude answers a channel follow-up in a thread
- **THEN** subsequent replies in that thread are governed by the thread session's `attentionLevel` and the existing thread auto-respond path
- **AND** the channel's ephemeral rule continues to govern only top-level messages

### Requirement: Channel Attention Reframe

On `channelReply` turns, the system SHALL let Claude set the ephemeral rule's attention level via `submit_response.channel_attention_level` (`"high" | "medium" | "low" | "off"`). `"off"` SHALL delete the rule. Omitting the field SHALL leave the rule's current (possibly ratcheted) level untouched. The field SHALL be distinct from `attention_level`, which continues to govern the session's thread dial.

#### Scenario: Reframe raises attention mid-conversation
- **WHEN** a channel continuation turn submits with `channel_attention_level: "high"`
- **THEN** the ephemeral rule's `attentionLevel` becomes `high`

#### Scenario: Off stops following
- **WHEN** a channel continuation turn submits with `channel_attention_level: "off"`
- **THEN** the ephemeral rule is deleted and Clack stops following the channel conversation

### Requirement: Kill Switches

The system SHALL delete a channel's ephemeral rule when: the configured stop emoji arrives as an inline top-level message in the channel or as a reaction on the bot's top-level post; an admin clicks the Home Tab "Stop following" button; or `delete_auto_respond_rule` targets the rule.

#### Scenario: Inline stop emoji top-level
- **WHEN** a user posts the configured stop emoji as a short top-level message in a channel with an ephemeral rule
- **THEN** the ephemeral rule is deleted
