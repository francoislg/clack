## ADDED Requirements

### Requirement: ClackSdk Exposes User Registry Accessor

The `ClackSdk` interface SHALL expose a `users` accessor giving plugins read access to centralized user identity and read/merge access to the plugin's own per-user namespace, without exposing population, persistence, or freshness concerns. The accessor SHALL provide exactly `get`, `list`, and `data(schema)`.

#### Scenario: get and list expose core identity

- **WHEN** a plugin calls `sdk.users.get(userId)` or `sdk.users.list()`
- **THEN** the SDK returns core identity (`{ userId, displayName }`) sourced from the central registry
- **AND** the plugin does not need to fetch or cache display names from Slack itself

#### Scenario: data(schema) is auto-scoped to the calling plugin

- **WHEN** a plugin calls `sdk.users.data(schema).get(userId)` or `.merge(userId, partial)`
- **THEN** the SDK resolves the namespace to `plugins.<callerPluginName>` on the user record (the same auto-scoping convention as `readFile`/`writeFile`)
- **AND** the plugin can neither read nor write another plugin's namespace

#### Scenario: Namespace data validated by the plugin's own schema

- **WHEN** a plugin reads or merges through `sdk.users.data(schema)`
- **THEN** the SDK round-trips the namespace value through the plugin-supplied zod schema
- **AND** returns the parsed value on success or `null` on absence/mismatch, never throwing on malformed stored data
