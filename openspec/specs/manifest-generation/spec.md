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

The system SHALL provide a script that generates the Slack app manifest file from configuration, merging branding with core scopes/events and conditionally adding feature-specific scopes/events based on config.

#### Scenario: Generate manifest with custom branding
- Given config with `slackApp.name` = "MyBot" and `slackApp.description` = "Custom description"
- When `npm run manifest` is executed
- Then `slack-app-manifest.json` is created
- And `display_information.name` equals "MyBot"
- And `display_information.description` equals "Custom description"

#### Scenario: Manifest includes core defaults
- Given any valid config
- When the manifest is generated
- Then `oauth_config.scopes.bot` contains core scopes: `channels:history`, `groups:history`, `chat:write`, `reactions:read`, `reactions:write`
- And `settings.event_subscriptions.bot_events` contains `reaction_added`
- And `settings.socket_mode_enabled` is `true`
- And `settings.interactivity.is_enabled` is `true`

#### Scenario: Direct messages feature adds DM scopes
- Given config with `directMessages.enabled` = true
- When the manifest is generated
- Then scopes include `im:history`, `mpim:history`
- And events include `message.im`

#### Scenario: Mentions feature adds mention scope and event
- Given config with `mentions.enabled` = true
- When the manifest is generated
- Then scopes include `app_mentions:read`
- And events include `app_mention`

#### Scenario: Hidden thread notification adds DM write scope
- Given config with `slack.notifyHiddenThread` = true (default)
- When the manifest is generated
- Then scopes include `im:write`

#### Scenario: Username fetching adds users scope
- Given config with `slack.fetchAndStoreUsername` = true
- When the manifest is generated
- Then scopes include `users:read`

#### Scenario: Manifest validation
- Given the generated manifest
- When validated against @slack/web-api types
- Then no type errors occur

---

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

