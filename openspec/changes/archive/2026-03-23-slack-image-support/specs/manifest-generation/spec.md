## MODIFIED Requirements

### Requirement: Manifest Generation Script

The system SHALL include Home tab scopes and events in the generated manifest, and SHALL include assistant-related scopes, events, and features when direct messages are enabled.

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

#### Scenario: Direct messages adds assistant scopes and events

- **GIVEN** `directMessages.enabled` is `true`
- **WHEN** the manifest is generated
- **THEN** scopes include `im:history`, `mpim:history`, `assistant:write`
- **AND** events include `message.im`, `assistant_thread_started`, `assistant_thread_context_changed`
- **AND** `features.assistant_view` is present with `assistant_description` and `suggested_prompts`

#### Scenario: DM write scope always included

- **GIVEN** any valid config
- **WHEN** the manifest is generated
- **THEN** scopes include `im:write` (needed for DM delivery of per-user reaction preference)
