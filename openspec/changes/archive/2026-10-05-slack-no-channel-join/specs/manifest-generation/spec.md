## MODIFIED Requirements

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
