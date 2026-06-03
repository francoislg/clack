## ADDED Requirements

### Requirement: Attention Level Dial

The system SHALL store a per-conversation **attention level** on each session as the single source of truth for thread engagement, with the value space `"always" | "high" | "medium" | "low" | "off"`. The field `attentionLevel` SHALL be persisted in `context.json`. A session is engaged when its level is not `"off"`; the system SHALL expose this as a derivation `isEngaged(session) := (attentionLevel ?? "medium") !== "off"`. There SHALL be no separate `autoResponseActive` boolean — engagement is `attentionLevel !== "off"`.

#### Scenario: Level persisted on the session

- **WHEN** a session's attention level is set or changed
- **THEN** the new `attentionLevel` value is written to the session's `context.json`
- **AND** is retained across application restarts

#### Scenario: isEngaged derives from the dial

- **WHEN** any code needs to know whether a thread is being auto-followed
- **THEN** it checks `attentionLevel !== "off"` (via the `isEngaged` helper)
- **AND** does NOT consult any `autoResponseActive` field

#### Scenario: Off is the disengaged state

- **WHEN** a session has `attentionLevel === "off"`
- **THEN** thread replies are not evaluated for auto-respond (no pre-analysis, no Claude call)
- **AND** the thread is considered disengaged

### Requirement: Attention Level Read-Time Migration

The system SHALL map legacy sessions that have no `attentionLevel` field onto the dial at load time, with no boot migration. A session whose persisted `autoResponseActive` is `false` SHALL be read as `"off"`; any other absent-level session (including `autoResponseActive: true` or absent) SHALL be read as `"medium"`.

#### Scenario: Disengaged legacy session maps to off

- **WHEN** a session is loaded that has no `attentionLevel` and has `autoResponseActive === false`
- **THEN** its effective level is `"off"`
- **AND** the thread remains disengaged

#### Scenario: Engaged legacy session maps to medium

- **WHEN** a session is loaded that has no `attentionLevel` and `autoResponseActive` is `true` or absent
- **THEN** its effective level is `"medium"`
- **AND** subsequent thread replies are gated by the `"medium"` policy

#### Scenario: No boot migration required

- **WHEN** the application starts with existing on-disk sessions lacking `attentionLevel`
- **THEN** no numbered/blocking migration runs for this field
- **AND** the legacy `autoResponseActive` field is dropped the next time the session is persisted

### Requirement: Initial Attention Level Resolution

The system SHALL resolve a new session's initial attention level from its trigger source: a scheduled (plugin cron) trigger uses `CronJobSpec.attentionLevel` (default `"medium"`), an `autoRespond` (rule) trigger uses the matched rule's `attentionLevel` (default `"medium"`), and `mentions`, `directMessages`, and `reactions` triggers default to `"medium"`. No trigger source SHALL set an initial level of `"off"` — the settable range for sources is `always | high | medium | low`.

#### Scenario: Plugin cron seeds the level

- **WHEN** a scheduled cron job with `attentionLevel: "high"` creates a session
- **THEN** the session's initial `attentionLevel` is `"high"`

#### Scenario: Rule seeds the level

- **WHEN** an auto-respond rule with `attentionLevel: "low"` matches a top-level message and a session is created
- **THEN** the session's initial `attentionLevel` is `"low"`

#### Scenario: Default for direct triggers

- **WHEN** a session is created from a mention, DM, or reaction trigger
- **THEN** the session's initial `attentionLevel` is `"medium"`

#### Scenario: Source cannot seed off

- **WHEN** a trigger source omits `attentionLevel`
- **THEN** the resolved initial level is `"medium"`, never `"off"`

### Requirement: Always Level Short-Circuits Pre-Analysis

The system SHALL respond to every thread reply on an engaged session whose level is `"always"` WITHOUT invoking the pre-analysis classifier.

#### Scenario: Always responds without a classifier call

- **WHEN** a thread reply arrives on a session with `attentionLevel === "always"`
- **THEN** the system proceeds directly to `processMessage()`
- **AND** does NOT make a pre-analysis Claude call

#### Scenario: Always thread is not auto-disengaged by the gate

- **WHEN** a session has `attentionLevel === "always"`
- **THEN** the pre-analysis classifier is never consulted
- **AND** the thread can only become `"off"` via Claude setting `attention_level: "off"` or a hard disengage signal (stop reaction, inline stop emoji, `stop_tracking`)

### Requirement: Level-Only Auto-Disengage at Low

The system SHALL permit the cheap pre-analysis classifier to disengage a thread (set `attentionLevel = "off"`) ONLY when the session's level is `"low"`. At `"medium"` and `"high"` the classifier SHALL NOT be able to disengage the thread; it may only return respond/skip. Descent toward `"off"` from a higher rung SHALL be driven by Claude (via `submit_response.attention_level`) or by a hard disengage signal.

#### Scenario: Low-rung sign-off disengages

- **WHEN** a thread reply on a `"low"` session is classified `"stop"` (explicit sign-off / topic change)
- **THEN** the system sets `attentionLevel = "off"`
- **AND** persists the session
- **AND** does NOT call `processMessage()`

#### Scenario: Medium thread cannot be killed by the classifier

- **WHEN** a thread reply arrives on a `"medium"` session
- **THEN** the classifier is offered only respond/skip verdicts
- **AND** no classifier verdict sets the level to `"off"`

#### Scenario: High thread cannot be killed by the classifier

- **WHEN** a thread reply arrives on a `"high"` session
- **THEN** the classifier is offered only respond/skip verdicts
- **AND** no classifier verdict sets the level to `"off"`

### Requirement: Channel-Engagement Gate Caps Always to High

When deciding whether a brand-new top-level message that matched an auto-respond rule should start a conversation (no session exists yet), the system SHALL apply the rule's attention level as the classifier policy, EXCEPT that a level of `"always"` SHALL be capped to `"high"` so the classifier still runs. This prevents an unfiltered channel-wide `"always"` rule from responding to every message.

#### Scenario: Always rule still runs pre-analysis on initial engagement

- **WHEN** a top-level message matches an `"always"` rule and no session exists
- **THEN** the system runs pre-analysis using the `"high"` policy
- **AND** starts a session only if the verdict is `"respond"`

#### Scenario: Other levels apply directly on initial engagement

- **WHEN** a top-level message matches a rule whose level is `"low"`, `"medium"`, or `"high"`
- **THEN** the initial channel-engagement pre-analysis uses that level's policy unchanged

### Requirement: Re-Engagement Resets To Medium

The system SHALL reset a disengaged session's attention level to `"medium"` when it is re-engaged by an @mention or a change-thread action button click.

#### Scenario: Mention re-engages an off thread to medium

- **WHEN** a user @mentions Clack in a thread whose session has `attentionLevel === "off"`
- **THEN** the session's `attentionLevel` is set to `"medium"`
- **AND** the session is persisted
- **AND** normal mention processing proceeds

#### Scenario: Button click re-engages an off thread to medium

- **WHEN** a user clicks a change-thread action button on a session with `attentionLevel === "off"`
- **THEN** the session's `attentionLevel` is set to `"medium"`
- **AND** the session is persisted

### Requirement: submit_response Attention Level Control

The `submit_response` tool SHALL accept an optional `attention_level` parameter that overwrites the session's attention level for subsequent turns. Its value space SHALL be the full ladder `always | high | medium | low | off` in tracking-capable contexts; `"off"` IS the disengage action. The current session level SHALL be surfaced to Claude in the delivery-context prompt so it can make relative adjustments. There SHALL be no separate `disengage` boolean.

#### Scenario: Claude raises the level

- **WHEN** Claude calls `submit_response` with `attention_level: "high"`
- **THEN** the session's `attentionLevel` is set to `"high"` after successful delivery
- **AND** the value is persisted

#### Scenario: Claude disengages via off

- **WHEN** Claude calls `submit_response` with `attention_level: "off"`
- **THEN** the session's `attentionLevel` is set to `"off"` (disengaged)
- **AND** the value is persisted
- **AND** this is the canonical replacement for the former `disengage: true`

#### Scenario: off omitted where tracking has no meaning

- **WHEN** the session's trigger type is `directMessages`, `reactions`, or `scheduled`
- **THEN** the `attention_level` parameter's value set excludes `"off"` (or the parameter is omitted where tuning has no effect)
- **AND** disengagement is not offered for that trigger

#### Scenario: Current level shown to Claude

- **WHEN** the delivery-context prompt is built for a tracking-capable session
- **THEN** the prompt states the session's current attention level
- **AND** explains that Claude may raise it, lower it, or set `"off"` to disengage

#### Scenario: Level not changed on failed delivery

- **WHEN** Claude supplies `attention_level` on the normal response path
- **AND** the deliver callback fails
- **THEN** the session's `attentionLevel` is NOT changed

### Requirement: Attention Level Exposure Across Tool and SDK Surfaces

The system SHALL expose the attention dial for both read and write wherever a trigger source can carry it. Write surfaces accept the settable range `always | high | medium | low` (and a clearing form where the field is optional); read surfaces return the persisted value (or null/absent when unset).

#### Scenario: Auto-respond rule tools

- **WHEN** an admin calls `add_auto_respond_rule` or `update_auto_respond_rule`
- **THEN** an optional `attentionLevel` argument writes the rule's level (empty string clears on update)
- **AND** `list_auto_respond_rules` returns each rule's `attentionLevel` when set

#### Scenario: Scheduled-message tools

- **WHEN** a user calls `create_scheduled_message` or `update_scheduled_message`
- **THEN** an optional `attentionLevel` argument writes the job's level (empty string clears on update)
- **AND** `list_scheduled_messages` and `get_scheduled_message` return the job's `attentionLevel`

#### Scenario: Plugin SDK thread conversation

- **WHEN** a plugin calls `sdk.startThreadConversation` with an `attentionLevel`
- **THEN** the created session is seeded with that level
- **AND** omitting it defaults the session to `"medium"`

#### Scenario: Trivia Tell-me-more uses high attention

- **WHEN** a player clicks the trivia "Tell me more" button
- **THEN** the follow-up thread conversation is started with `attentionLevel: "high"`
- **AND** Clack eagerly follows the player's subsequent questions in that thread
