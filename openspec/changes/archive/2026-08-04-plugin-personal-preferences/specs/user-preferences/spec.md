## ADDED Requirements

### Requirement: Plugin Preferences Fold

The persisted `UserPreferences` object SHALL support an optional `plugins` fold: a record keyed by plugin name whose values are arbitrary JSON objects (each plugin's user-chosen preference slice). The fold lives alongside the core preference fields in `data/state/user-preferences.json` and is written and read as part of the same store. Writing a plugin's slice SHALL merge into (not replace) that user's existing slice for that plugin, and SHALL leave core fields and other plugins' slices untouched. This fold holds user-chosen, modal-surfaced preferences and is distinct from the `sdk.users.data` user-registry namespace, which remains bot-managed extension state.

#### Scenario: Plugin slice stored per user per plugin

- **WHEN** a plugin's preference values are saved for a user
- **THEN** they are stored under `plugins.<plugin>` in that user's preferences entry
- **AND** other users' entries and other plugins' slices are unaffected

#### Scenario: Merge preserves untouched keys

- **WHEN** a plugin merges a partial slice for a user who already has a slice for that plugin
- **THEN** keys not present in the partial retain their previous values
- **AND** core preference fields (e.g. `reactionDelivery`) are unchanged

## MODIFIED Requirements

### Requirement: User-preferences loading is schema-driven

`userPreferences.ts` SHALL parse the preferences map against a zod schema (`Record<userId, Partial<UserPreferences>>`) instead of a bare `JSON.parse` + type assertion. The deprecated `dmOptOut` field SHALL be accepted (`.optional()`) for backward compatibility but not surfaced into the runtime type. The schema SHALL also accept an optional `plugins` fold (`Record<pluginName, JsonObject>`) parsed permissively: an unknown or malformed individual plugin slice SHALL be preserved or fall back to an empty slice without discarding the rest of the user's preferences. On whole-file parse failure it SHALL return `{}` and per-key defaults SHALL apply on read, exactly as today (log + fallback, never throw).

#### Scenario: Deprecated dmOptOut is accepted, not surfaced

- **WHEN** a stored preferences file still contains `dmOptOut`
- **THEN** the file parses successfully and `dmOptOut` does not appear in the runtime preferences (other fields read with their current defaults)

#### Scenario: Corrupt preferences degrade to empty

- **WHEN** the preferences file is malformed or fails the schema
- **THEN** the loader returns `{}` and reads fall back to `DEFAULT_PREFERENCES`, exactly as today

#### Scenario: Plugins fold parsed permissively

- **WHEN** a stored preferences entry contains a `plugins` fold
- **THEN** the fold is retained on the parsed entry
- **AND** a malformed individual plugin slice does not discard the user's core preferences or other plugins' slices
