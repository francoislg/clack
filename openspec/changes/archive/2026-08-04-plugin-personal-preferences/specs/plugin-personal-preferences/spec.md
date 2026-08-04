## ADDED Requirements

### Requirement: Plugin Preference Registration

A plugin SHALL be able to declare per-user preference fields via `sdk.registerPreferences({ schema, fields })`, where `schema` is a zod schema describing the plugin's persisted preference object and `fields` is an ordered list of field descriptors. Registration happens at plugin load time and is harvested into the plugin's load result the same way tools and instructions are.

#### Scenario: Plugin registers preference fields

- **WHEN** a plugin calls `sdk.registerPreferences({ schema, fields })` during load
- **THEN** the registration is captured in the plugin's load result
- **AND** the declared fields become available to the Personal Preferences modal for the plugin's namespace

#### Scenario: Plugin registers no preferences

- **WHEN** a plugin never calls `sdk.registerPreferences`
- **THEN** no preference section is contributed for that plugin
- **AND** the Personal Preferences modal is identical to a build with no plugin preferences

### Requirement: Preference Field Descriptor

Each field descriptor SHALL carry a `key` (unique within the plugin), a `type`, a label reference resolved through the plugin's own dictionary, and a `default` value. Version 1 SHALL support exactly one `type`: `"toggle"` (a boolean on/off preference). The `key` SHALL correspond to a field on the plugin's registered zod schema.

#### Scenario: Toggle field descriptor

- **WHEN** a plugin declares a field `{ key, type: "toggle", label, default: boolean }`
- **THEN** the modal renders a boolean on/off control for that field
- **AND** the persisted value for that key is a boolean

#### Scenario: Unsupported field type rejected

- **WHEN** a plugin declares a field with a `type` other than `"toggle"`
- **THEN** the registration for that field SHALL be rejected with a plugin-scoped warning
- **AND** the invalid field is not rendered

### Requirement: Modal Injection of Plugin Preferences

The Personal Preferences modal SHALL render one section per enabled plugin that registered preferences: a plugin header, a divider, and one Block Kit control per declared field. Each control SHALL pre-select the user's current stored value for that field, or the field's `default` when unset. Sections SHALL appear only for plugins that are currently loaded.

#### Scenario: Enabled plugin contributes a section

- **WHEN** a user opens the Personal Preferences modal
- **AND** an enabled plugin has registered a preference field
- **THEN** the modal shows a section for that plugin with a control per field
- **AND** each control reflects the user's stored value or the field default

#### Scenario: Disabled plugin contributes nothing

- **WHEN** a plugin that registered preferences is not loaded
- **THEN** the modal renders no section for that plugin

### Requirement: Localized Preference Labels

Plugin preference field labels are on the direct-to-Slack path and SHALL be resolved through the owning plugin's registered dictionary (`sdk.t`) at modal render time, in the viewing user's language. Core SHALL NOT add i18n keys for plugin-declared labels.

#### Scenario: Label resolved in viewer language

- **WHEN** the modal renders a plugin preference field for a user
- **THEN** the field label is resolved via the owning plugin's dictionary for that user's language

### Requirement: Preference Persistence Fan-Out

On Personal Preferences modal submit, core SHALL persist its own preference fields exactly as before, and then, for each plugin that contributed fields, validate the submitted values against the plugin's registered schema and merge them into that user's slice of the preferences `plugins` fold. All writes occur in a single store (`data/state/user-preferences.json`).

#### Scenario: Plugin values saved on submit

- **WHEN** a user submits the Personal Preferences modal with a plugin toggle changed
- **THEN** the new value is validated against the plugin's schema
- **AND** merged into `user-preferences.json` under `plugins.<plugin>` for that user
- **AND** core preference fields are persisted in the same save

#### Scenario: Invalid plugin submission does not corrupt state

- **WHEN** a submitted plugin value fails the plugin's schema
- **THEN** that plugin's slice is left unchanged
- **AND** core preferences and other plugins' slices are still persisted

#### Scenario: Store write failure fails soft

- **WHEN** persisting the submitted preferences fails at the store layer (e.g. a disk write error)
- **THEN** the failure is logged and the submit handler does not throw
- **AND** the persisted state on disk is not left partially written or corrupted

### Requirement: Simplified Preference Read

The SDK SHALL expose `sdk.preferences.get(userId, schema)` that reads the calling plugin's slice from the user-preferences `plugins` fold and validates it against the provided zod schema. It SHALL return the parsed object when present and valid, and `null` when the user has no slice for the plugin or the slice fails validation. A plugin SHALL only be able to read its own slice.

#### Scenario: Read own preference slice

- **WHEN** a plugin calls `sdk.preferences.get(userId, schema)`
- **AND** the user has a valid slice for that plugin
- **THEN** the parsed preference object is returned

#### Scenario: Read with no slice returns null

- **WHEN** a plugin calls `sdk.preferences.get(userId, schema)`
- **AND** the user has never set a preference for that plugin
- **THEN** `null` is returned

#### Scenario: Malformed slice returns null

- **WHEN** a plugin calls `sdk.preferences.get(userId, schema)`
- **AND** the user's stored slice for that plugin fails validation against the provided schema
- **THEN** `null` is returned (the same result as an absent slice, via a distinct validation-failure path)
- **AND** the stored slice is not mutated

#### Scenario: Plugin isolation

- **WHEN** a plugin reads preferences
- **THEN** it receives only its own namespaced slice and cannot read another plugin's slice
