## MODIFIED Requirements

### Requirement: Manifest Generation Script

The system SHALL include Home tab scopes and events in the generated manifest, and SHALL include DM-related scopes, events, and features when direct messages are enabled. When `directMessages.dmType` is `"assistant"` (or absent), the manifest SHALL additionally emit the Slack Agents & Assistants API scope, events, and feature block. When `directMessages.dmType` is `"classic"`, the manifest SHALL omit all assistant-specific entries.

#### Scenario: Home tab adds required scopes and events
- **GIVEN** any valid config (Home tab is always enabled for role management)
- **WHEN** the manifest is generated
- **THEN** scopes include `users:read` (for user info and disabled check)
- **AND** events include `app_home_opened`

#### Scenario: Core scopes include files:read

- **GIVEN** any valid config
- **WHEN** the manifest is generated
- **THEN** scopes include `files:read` (required for downloading images uploaded in Slack messages)

#### Scenario: Home tab enables app home feature
- **GIVEN** any valid config
- **WHEN** the manifest is generated
- **THEN** `features.app_home.home_tab_enabled` is `true`
- **AND** `features.app_home.messages_tab_enabled` reflects whether direct messages are enabled
- **AND** `features.app_home.messages_tab_read_only_enabled` is `false`

#### Scenario: Direct messages adds core DM scopes and event
- **GIVEN** `directMessages.enabled` is `true`
- **WHEN** the manifest is generated
- **THEN** scopes include `im:history`, `im:read`, `mpim:history`, `mpim:read`
- **AND** events include `message.im`

#### Scenario: Assistant dmType adds assistant scopes, events, and feature
- **GIVEN** `directMessages.enabled` is `true` AND (`directMessages.dmType` is `"assistant"` OR `directMessages.dmType` is absent)
- **WHEN** the manifest is generated
- **THEN** scopes include `assistant:write` (in addition to the core DM scopes)
- **AND** events include `assistant_thread_started` and `assistant_thread_context_changed` (in addition to `message.im`)
- **AND** `features.assistant_view` is present with `assistant_description` and `suggested_prompts`

#### Scenario: Classic dmType omits assistant scopes, events, and feature
- **GIVEN** `directMessages.enabled` is `true` AND `directMessages.dmType` is `"classic"`
- **WHEN** the manifest is generated
- **THEN** scopes do NOT include `assistant:write`
- **AND** events do NOT include `assistant_thread_started` or `assistant_thread_context_changed`
- **AND** `features.assistant_view` is NOT present
- **AND** the core DM scopes and `message.im` event are still present

#### Scenario: DM write scope always included
- **GIVEN** any valid config
- **WHEN** the manifest is generated
- **THEN** scopes include `im:write` (needed for DM delivery of per-user reaction preference)
