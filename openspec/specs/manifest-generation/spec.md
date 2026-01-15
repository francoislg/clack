# manifest-generation Specification

## Purpose
TBD - created by archiving change add-manifest-generator. Update Purpose after archive.
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

The system SHALL provide a script that generates the Slack app manifest file from configuration, merging branding with static defaults for scopes and events.

#### Scenario: Generate manifest with custom branding
- Given config with `slackApp.name` = "MyBot" and `slackApp.description` = "Custom description"
- When `npm run manifest` is executed
- Then `slack-app-manifest.json` is created
- And `display_information.name` equals "MyBot"
- And `display_information.description` equals "Custom description"

#### Scenario: Manifest includes required defaults
- Given any valid config
- When the manifest is generated
- Then `oauth_config.scopes.bot` contains required scopes: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `reactions:read`, `reactions:write`, `users:read`
- And `settings.event_subscriptions.bot_events` contains `reaction_added`
- And `settings.socket_mode_enabled` is `true`
- And `settings.interactivity.is_enabled` is `true`

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

