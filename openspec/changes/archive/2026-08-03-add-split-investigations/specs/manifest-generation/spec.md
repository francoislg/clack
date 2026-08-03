# manifest-generation Delta

## ADDED Requirements

### Requirement: Conditional investigation scopes

When `config.investigations.enabled` is true, the manifest generator SHALL add exactly the scopes and event subscriptions the follow pipeline needs that are not already present from other features, following the `allowPublicSearch` conditional pattern:

- Bot scope `channels:join` (for public-channel bootstrap auto-join) — not otherwise present.
- Bot events `message.channels` and `message.groups` (followed-thread deltas in public and private channels) — deduplicated against the same events already added by `autoRespond`.

The read scopes `conversations.replies` needs (`channels:history`, `groups:history`, `channels:read`, `groups:read`) are already in `CORE_SCOPES`, so no additional read scopes are required. When disabled, the generated manifest SHALL be byte-identical to one generated without the feature. Documentation SHALL note that enabling requires manifest re-upload and app reinstall.

#### Scenario: Enabled adds scopes

- **WHEN** the manifest is generated with `investigations.enabled: true`
- **THEN** the bot scopes include `channels:join`
- **AND** the bot events include `message.channels` and `message.groups` (with no duplicates when `autoRespond` also added them)

#### Scenario: Disabled leaves manifest untouched

- **WHEN** the manifest is generated with the feature disabled or absent
- **THEN** the output is identical to a build without the feature
