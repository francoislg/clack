## ADDED Requirements

### Requirement: Conditional List scopes

The required bot scopes SHALL follow `lists.mode`: `"read"` SHALL add `lists:read`; `"write"` SHALL add `lists:read` and `lists:write`; `"off"` or an absent block SHALL add neither. The List mode SHALL add no bot events.

#### Scenario: Read mode scopes

- **WHEN** the manifest is generated with `lists.mode: "read"`
- **THEN** the bot scopes include `lists:read` and not `lists:write`

#### Scenario: Write mode scopes

- **WHEN** the manifest is generated with `lists.mode: "write"`
- **THEN** the bot scopes include `lists:read` and `lists:write`

#### Scenario: Off

- **WHEN** the manifest is generated without a `lists` block
- **THEN** the bot scopes include no List scope

#### Scenario: No events

- **WHEN** the manifest is generated with `lists.mode: "write"`
- **THEN** the bot events are the same as with `lists.mode: "off"`

#### Scenario: Invalid List mode

- **WHEN** the manifest is generated from a config where `lists.mode` is not a supported value
- **THEN** generation fails with an error naming `lists.mode`
