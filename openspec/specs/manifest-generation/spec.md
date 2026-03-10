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

The system SHALL include Home tab scopes and events in the generated manifest, and SHALL include assistant-related scopes, events, and features when direct messages are enabled.

#### Scenario: Home tab adds required scopes and events
- **GIVEN** any valid config (Home tab is always enabled for role management)
- **WHEN** the manifest is generated
- **THEN** scopes include `users:read` (for user info and disabled check)
- **AND** events include `app_home_opened`

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
