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

### Requirement: Conditional investigation scopes

When `config.investigations.enabled` is true, the manifest generator SHALL add exactly the event subscriptions the follow pipeline needs that are not already present from other features, following the `allowPublicSearch` conditional pattern:

- Bot events `message.channels` and `message.groups` (followed-thread deltas in public and private channels) — deduplicated against the same events already added by `autoRespond`.

The generator SHALL NOT request `channels:join` under any configuration. The read scopes `conversations.replies` needs (`channels:history`, `groups:history`, `channels:read`, `groups:read`) are already in `CORE_SCOPES`, so no additional scopes are required. When disabled, the generated manifest SHALL be byte-identical to one generated without the feature. Documentation SHALL note that enabling requires a manifest re-upload.

#### Scenario: Enabled adds events

- **WHEN** the manifest is generated with `investigations.enabled: true`
- **THEN** the bot events include `message.channels` and `message.groups` (with no duplicates when `autoRespond` also added them)
- **AND** the bot scopes do not include `channels:join`

#### Scenario: Disabled leaves manifest untouched

- **WHEN** the manifest is generated with the feature disabled or absent
- **THEN** the output is identical to a build without the feature

### Requirement: Manifest config validation

The manifest generator SHALL parse the config it reads through a zod schema built from the application's config schemas, and SHALL fail with a formatted error naming every offending key when a manifest-relevant value is invalid. It SHALL NOT require Slack credentials or a `repositories` entry, and SHALL ignore config keys the manifest does not read. A missing config file SHALL generate the default manifest.

#### Scenario: Wrong-typed feature flag

- **WHEN** the manifest is generated from a config where `investigations.enabled` is the string `"true"`
- **THEN** generation fails with an error naming `investigations.enabled`
- **AND** no manifest file is written

#### Scenario: Several invalid values

- **WHEN** two manifest-relevant values are invalid
- **THEN** the error names both keys

#### Scenario: Invalid dmType

- **WHEN** the manifest is generated from a config where `directMessages.dmType` is not a supported value
- **THEN** generation fails with an error listing the supported values

#### Scenario: Config without repositories or auth

- **WHEN** the manifest is generated from a config with no `repositories` key and no Slack auth file present
- **THEN** generation succeeds

#### Scenario: Unrelated invalid value

- **WHEN** the config holds an invalid value under a key the manifest does not read
- **THEN** generation succeeds

#### Scenario: Missing config file

- **WHEN** no config file exists
- **THEN** the default manifest is generated

### Requirement: Shared scope and event definition

The bot scopes and event subscriptions for a set of enabled features SHALL be derived by one definition used by both the manifest generator and the running bot. The manifest generated from a valid config SHALL be identical to the manifest generated before the definition was shared.

#### Scenario: Generator and bot agree

- **WHEN** the manifest generator and the running bot derive scopes from the same config
- **THEN** both obtain the same scope list

#### Scenario: Output unchanged

- **WHEN** the manifest is generated from a valid config
- **THEN** its scopes, events and features match the output of the generator's existing test fixtures

### Requirement: Conditional canvas scopes

The required bot scopes SHALL follow `canvases.mode`: `"read"` SHALL add `canvases:read`; `"write"` SHALL add `canvases:read` and `canvases:write`; `"off"` or an absent block SHALL add neither. The canvas mode SHALL add no bot events.

#### Scenario: Read mode scopes

- **WHEN** the manifest is generated with `canvases.mode: "read"`
- **THEN** the bot scopes include `canvases:read` and not `canvases:write`

#### Scenario: Write mode scopes

- **WHEN** the manifest is generated with `canvases.mode: "write"`
- **THEN** the bot scopes include `canvases:read` and `canvases:write`

#### Scenario: Off

- **WHEN** the manifest is generated without a `canvases` block
- **THEN** the bot scopes include no canvas scope

#### Scenario: No events

- **WHEN** the manifest is generated with `canvases.mode: "write"`
- **THEN** the bot events are the same as with `canvases.mode: "off"`

#### Scenario: Invalid canvas mode

- **WHEN** the manifest is generated from a config where `canvases.mode` is not a supported value
- **THEN** generation fails with an error naming `canvases.mode`
