## ADDED Requirements

### Requirement: allowPublicSearch Configuration Flag

The system SHALL expose an optional top-level boolean config key `allowPublicSearch`. It SHALL be validated by a fail-fast zod schema as an optional boolean, and an absent value SHALL be treated as `false`. The flag SHALL gate both the Slack manifest scope and the registration of the `search_messages` tool.

#### Scenario: Flag absent from config
- **WHEN** `data/config.json` contains no `allowPublicSearch` key
- **THEN** the effective value is `false`
- **AND** the generated manifest omits the `search:read.public` scope
- **AND** `search_messages` is not registered in any session

#### Scenario: Flag enabled
- **WHEN** `allowPublicSearch` is `true`
- **THEN** the generated manifest includes the `search:read.public` bot scope
- **AND** `search_messages` is registered for sessions meeting the role requirement

#### Scenario: Flag is not a boolean
- **WHEN** `allowPublicSearch` is set to a non-boolean value
- **THEN** config validation fails at boot with a formatted zod error

### Requirement: search_messages Tool

When enabled, the system SHALL provide a `search_messages` query tool that performs literal keyword search over public-channel message text via Slack's `assistant.search.context` method. The tool SHALL pass `disable_semantic_search: true`, `channel_types: "public_channel"`, and `content_types: "messages"` on every call. Results SHALL include a permalink for each match.

#### Scenario: Literal keyword search
- **WHEN** Claude calls `search_messages` with a query string in a session carrying an `action_token`
- **THEN** the tool calls `assistant.search.context` with `disable_semantic_search: true`
- **AND** returns matching public-channel messages with their permalinks

#### Scenario: Slack search operators pass through
- **WHEN** the query string contains operators such as `in:<#C123>`, `from:<@U123>`, or `before:2026-01-01`
- **THEN** the operators are forwarded to Slack unmodified in the `query` argument

#### Scenario: Private content is never returned
- **WHEN** any search is performed
- **THEN** `channel_types` is restricted to `public_channel`
- **AND** no private channel, DM, or group DM content is requested or returned

#### Scenario: Result count is bounded
- **WHEN** a search would match more results than the configured per-call cap
- **THEN** the tool returns at most that cap
- **AND** indicates to Claude that the results were truncated

#### Scenario: No matches
- **WHEN** a search returns zero results from Slack
- **THEN** the tool returns an empty result set distinguishable from an error

### Requirement: Role Gating

The `search_messages` tool SHALL be available at the `member` role tier, matching other unrestricted query tools.

#### Scenario: Member can search
- **WHEN** a user with the `member` role triggers a session with the flag enabled and an `action_token` present
- **THEN** `search_messages` is registered in its full form

### Requirement: action_token Sourcing and Availability

The system SHALL capture Slack's `action_token` from the triggering event payload and carry it on the tool context for the duration of the session. It SHALL NOT be persisted to session storage or reused across sessions.

#### Scenario: Token captured from a direct message
- **WHEN** a session is triggered by a `message.im` event carrying an `action_token`
- **THEN** the token is placed on the tool context
- **AND** `search_messages` is registered in its full form

#### Scenario: Token captured from an app mention
- **WHEN** a session is triggered by an `app_mention` event carrying an `action_token`
- **THEN** the token is placed on the tool context
- **AND** `search_messages` is registered in its full form

#### Scenario: Token is not persisted
- **WHEN** a session carrying an `action_token` is written to `data/sessions/`
- **THEN** the persisted record contains no `action_token`

### Requirement: Degraded Tool Shape Without an action_token

In a session with no `action_token` — including reaction-triggered and cron-triggered sessions — the system SHALL still register `search_messages`, but in a degraded form whose parameter schema omits `query` and whose description states that search is unavailable in this context and which triggers do support it. Invoking the degraded tool SHALL return an error result naming the supported triggers. These strings are Claude-facing and SHALL remain English.

#### Scenario: Reaction-triggered session
- **WHEN** a session is triggered by `reaction_added` with the flag enabled
- **THEN** `search_messages` is registered without a `query` parameter
- **AND** its description states that search requires a direct message or an @mention

#### Scenario: Cron-triggered session
- **WHEN** a scheduled cron job fires with the flag enabled
- **THEN** `search_messages` is registered in its degraded form

#### Scenario: Degraded tool invoked
- **WHEN** Claude calls the degraded `search_messages`
- **THEN** an error result is returned naming direct messages and @mentions as the supported triggers
- **AND** no Slack API call is made

### Requirement: Degradation on Missing Scope

When Slack rejects a search because the bot token lacks `search:read.public` — the expected state when the flag was enabled without reinstalling the app — the system SHALL surface that condition distinctly from an empty result set.

#### Scenario: Token predates the scope grant
- **WHEN** Slack returns a `missing_scope` error
- **THEN** the tool returns an error result identifying the missing scope and stating that the app must be reinstalled to the workspace
- **AND** does not return an empty result set

### Requirement: Reaction Usage Is Out of Scope

Search covers message text only. The tool description SHALL state that emoji used as reactions are not message content and are not findable through this tool.

#### Scenario: Emoji shortcode typed in message text
- **WHEN** a message body contains the literal text `:bob:`
- **THEN** that message is eligible to match a `search_messages` query for `:bob:`

#### Scenario: Emoji applied as a reaction
- **WHEN** a message has a `:bob:` reaction but does not contain `:bob:` in its text
- **THEN** that message is not returned by `search_messages`
