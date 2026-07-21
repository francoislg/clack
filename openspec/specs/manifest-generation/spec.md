# manifest-generation Specification

## Purpose
Generate a Slack app manifest file from configuration, with scopes and events conditionally included based on enabled features.
## Requirements
### Requirement: Slack App Configuration

The config file SHALL support Slack app branding configuration with optional `slackApp` section containing `name`, `description`, and `backgroundColor` fields.

#### Scenario: Valid branding config
- Given a config with `slackApp.name`, `slackApp.description`, and `slackApp.backgroundColor`
- When the config is loaded
- Then it validates the name is non-empty
- And the backgroundColor matches hex color format `#RRGGBB`

#### Scenario: Default branding values
- Given a config without `slackApp` section
- When the manifest is generated
- Then it uses defaults: name="Clack", description="Ask questions about your codebase using reactions", backgroundColor="#4A154B"

---

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

### Requirement: Manifest File Management

The manifest file SHALL be generated locally and MUST NOT be tracked in git.

#### Scenario: Manifest ignored by git
- Given the repository
- When `.gitignore` is checked
- Then `slack-app-manifest.json` is listed

#### Scenario: Setup requires manifest generation
- Given a fresh clone of the repository
- When following setup instructions
- Then the user must run `npm run manifest` before using the Slack app config

### Requirement: Agent DM Manifest Emission

When `directMessages.enabled` is true and `dmType` is `"agent"`, the manifest generator SHALL emit the Agent messaging experience: an `agent_view` feature block with an `agent_description`. It SHALL keep the `assistant:write` scope (still used for `assistant.threads.*` status/title/prompt calls), subscribe `app_home_opened` (already core) and `message.im`, and SHALL NOT subscribe `assistant_thread_started` or `assistant_thread_context_changed`. The `"assistant"` and `"classic"` branches SHALL be unchanged.

#### Scenario: Agent DM mode emits agent_view
- **WHEN** `directMessages.enabled` is true and `dmType` is `"agent"`
- **THEN** the manifest's features include an `agent_view` block with an `agent_description`
- **AND** the manifest does not include an `assistant_view` block

#### Scenario: Agent thread events are not subscribed
- **WHEN** `dmType` is `"agent"`
- **THEN** the generated `bot_events` include `app_home_opened` and `message.im`
- **AND** do not include `assistant_thread_started` or `assistant_thread_context_changed`

#### Scenario: assistant:write scope retained under agent mode
- **WHEN** `dmType` is `"agent"`
- **THEN** the generated bot scopes include `assistant:write`

#### Scenario: Assistant and classic emission unchanged by the agent branch
- **WHEN** `dmType` is `"assistant"` or `"classic"`
- **THEN** the generated manifest for that mode is identical whether or not the `"agent"` branch exists in the generator (the baseline is the post-dependency-upgrade output, isolating the agent-branch addition from any Bolt/web-api upgrade effects)

