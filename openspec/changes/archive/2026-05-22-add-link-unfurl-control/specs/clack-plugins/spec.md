## ADDED Requirements

### Requirement: ClackSdk Posting Helpers Accept suppressUnfurls

Every plugin SDK helper that posts a Slack message (currently `dmOwner`, and any future helpers added that wrap `chat.postMessage`) SHALL accept an optional `suppressUnfurls: boolean` parameter. When `true`, the underlying `chat.postMessage` call SHALL include `unfurl_links: false` and `unfurl_media: false`. When absent or `false`, the call SHALL NOT include those keys.

#### Scenario: dmOwner with suppressUnfurls true

- **WHEN** a plugin calls `sdk.dmOwner(text, { suppressUnfurls: true })`
- **THEN** the resulting `chat.postMessage` call contains `unfurl_links: false`
- **AND** contains `unfurl_media: false`

#### Scenario: dmOwner without suppressUnfurls

- **WHEN** a plugin calls `sdk.dmOwner(text)` with no options
- **THEN** the resulting `chat.postMessage` call does NOT contain `unfurl_links`
- **AND** does NOT contain `unfurl_media`
- **AND** Slack's default unfurling applies

#### Scenario: Future posting helpers honor the same contract

- **GIVEN** the plugin SDK gains a new posting helper that wraps `chat.postMessage`
- **WHEN** the helper is added
- **THEN** it SHALL accept the same optional `suppressUnfurls: boolean` parameter
- **AND** route the value through the shared suppress-unfurls helper defined in `link-unfurl-control`
