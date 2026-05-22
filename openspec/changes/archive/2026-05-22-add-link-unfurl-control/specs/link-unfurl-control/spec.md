## ADDED Requirements

### Requirement: Shared Suppress-Unfurls Option Across All Outgoing Slack Messages

The system SHALL accept an opt-in `suppressUnfurls: boolean` parameter on every Clack code path that sends a Slack message via `chat.postMessage`. When the option is `true`, the system SHALL set both `unfurl_links: false` and `unfurl_media: false` on the underlying Slack API call. When the option is `false`, absent, or `undefined`, the system SHALL NOT include `unfurl_links` or `unfurl_media` in the API call, preserving Slack's default unfurling behavior.

The system SHALL provide a single shared helper that converts the boolean into the correct Slack parameter pair, so the translation lives in exactly one place. Every Clack send path SHALL use this helper rather than spreading the two parameters inline.

#### Scenario: Suppress flag absent preserves Slack default

- **WHEN** a Clack send path is invoked without `suppressUnfurls`, or with `suppressUnfurls: false`
- **THEN** the resulting `chat.postMessage` argument object SHALL NOT contain an `unfurl_links` key
- **AND** SHALL NOT contain an `unfurl_media` key
- **AND** Slack applies its default unfurling rules unchanged

#### Scenario: Suppress flag true sets both Slack params

- **WHEN** a Clack send path is invoked with `suppressUnfurls: true`
- **THEN** the resulting `chat.postMessage` argument object SHALL contain `unfurl_links: false`
- **AND** SHALL contain `unfurl_media: false`

#### Scenario: Helper applied consistently across paths

- **GIVEN** the shared helper that converts `suppressUnfurls` into Slack params
- **WHEN** any Clack send path (structured-message front door, DM helpers, worker status, scheduler DMs, quarantine notifier, plugin SDK helpers, streamer fallback, migration admin DM, trivia question posting) builds its `chat.postMessage` arguments
- **THEN** the path SHALL produce the unfurl parameters via the shared helper rather than literal inline keys
- **AND** the helper's output is the only source of `unfurl_links` / `unfurl_media` on outgoing calls

### Requirement: Structured-Message Front Door Honors Suppress-Unfurls

The `postStructuredMessage` helper SHALL accept an optional `suppressUnfurls: boolean` field on its options object and forward it to the underlying `chat.postMessage` call via the shared helper.

#### Scenario: postStructuredMessage with suppressUnfurls true

- **WHEN** a caller invokes `postStructuredMessage(client, { channel, blocks, suppressUnfurls: true })`
- **THEN** the helper calls `chat.postMessage` with `unfurl_links: false` and `unfurl_media: false`
- **AND** the existing `text`-fallback, `blocks`, and `thread_ts` behavior are unchanged

#### Scenario: postStructuredMessage without suppressUnfurls

- **WHEN** a caller invokes `postStructuredMessage(client, { channel, blocks })` with no `suppressUnfurls`
- **THEN** the helper calls `chat.postMessage` without `unfurl_links` or `unfurl_media`
- **AND** Slack's default unfurling applies

### Requirement: DM and Notification Helpers Honor Suppress-Unfurls

`sendDirectMessage`, `sendErrorReport`, the worker quarantine notifier, the cron scheduler's DM, and the migration admin DM SHALL each accept an optional `suppressUnfurls: boolean` parameter and forward it to `chat.postMessage` via the shared helper.

#### Scenario: sendDirectMessage with suppressUnfurls

- **WHEN** a caller invokes `sendDirectMessage(client, userId, text, blocks, { suppressUnfurls: true })`
- **THEN** the resulting `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`

#### Scenario: Quarantine notifier with suppressUnfurls

- **WHEN** the worker quarantine notifier posts to an owner DM with `suppressUnfurls: true`
- **THEN** the resulting `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`

### Requirement: Worker reportStatus Honors Suppress-Unfurls

The worker `reportStatus` tool SHALL accept an optional `suppress_unfurls: boolean` parameter on its tool schema. When set, the underlying `chat.postMessage` call SHALL include `unfurl_links: false` and `unfurl_media: false`.

#### Scenario: reportStatus with suppress_unfurls true

- **WHEN** Claude calls `reportStatus` with `suppress_unfurls: true`
- **THEN** the posted status message is sent with unfurling disabled

#### Scenario: reportStatus without suppress_unfurls

- **WHEN** Claude calls `reportStatus` without the field
- **THEN** the posted status message uses Slack's default unfurling (links to PRs, dashboards, etc. preview as today)

### Requirement: Plugin Posting Helpers Honor Suppress-Unfurls

Plugin posting helpers exposed by the plugin SDK (including but not limited to `dmOwner`) SHALL accept an optional `suppressUnfurls: boolean` parameter. When set, the underlying `chat.postMessage` SHALL include `unfurl_links: false` and `unfurl_media: false`.

#### Scenario: Plugin dmOwner with suppressUnfurls

- **WHEN** a plugin calls `sdk.dmOwner(text, { suppressUnfurls: true })`
- **THEN** the resulting DM `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`

#### Scenario: Plugin tool that posts its own blocks

- **WHEN** a plugin tool (e.g., trivia `postQuestions`) constructs a `chat.postMessage` argument object with `suppressUnfurls: true`
- **THEN** the resulting call contains `unfurl_links: false` and `unfurl_media: false`

### Requirement: Streamer Final-Post Fallback Honors Suppress-Unfurls

When the Slack streamer falls back from `chatStream` to `chat.postMessage` for the final delivery, the fallback SHALL accept the same `suppressUnfurls` signal as the structured-message front door and forward it via the shared helper.

#### Scenario: Streamer fallback with suppressUnfurls

- **WHEN** the streamer's `finalize` path falls back to `chat.postMessage` and the originating request opted into `suppressUnfurls: true`
- **THEN** the fallback `chat.postMessage` call contains `unfurl_links: false` and `unfurl_media: false`

### Requirement: Default Behavior Is Backwards-Compatible

The introduction of `suppressUnfurls` SHALL be purely additive. No existing call site's behavior changes unless that call site explicitly sets `suppressUnfurls: true`.

#### Scenario: Existing call sites unchanged

- **GIVEN** the codebase pre-change has N call sites that omit any unfurl parameter
- **WHEN** the change lands and those call sites continue to omit the parameter
- **THEN** every one of those calls SHALL produce the same `chat.postMessage` arguments as before the change
- **AND** no `unfurl_links` or `unfurl_media` keys appear in those arguments
