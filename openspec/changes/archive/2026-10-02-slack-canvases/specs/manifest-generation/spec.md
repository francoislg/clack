## ADDED Requirements

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
