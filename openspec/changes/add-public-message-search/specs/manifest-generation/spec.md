## ADDED Requirements

### Requirement: Public Search Scope

The manifest generation script SHALL add the `search:read.public` bot scope when and only when `allowPublicSearch` is enabled in `data/config.json`. The scope SHALL be added conditionally in `buildScopes`, not to `CORE_SCOPES`. No additional bot events SHALL be subscribed for this feature — the `action_token` sources (`message`, `app_mention`) are already subscribed by the direct-message and mention features.

#### Scenario: Public search enabled adds the scope
- **WHEN** `allowPublicSearch` is `true` in config
- **THEN** the generated manifest's bot scopes include `search:read.public`

#### Scenario: Public search disabled omits the scope
- **WHEN** `allowPublicSearch` is `false` or absent
- **THEN** the generated manifest's bot scopes do not include `search:read.public`

#### Scenario: No event subscriptions change
- **WHEN** `allowPublicSearch` is toggled between `true` and `false`
- **THEN** the generated manifest's `bot_events` list is identical in both cases
