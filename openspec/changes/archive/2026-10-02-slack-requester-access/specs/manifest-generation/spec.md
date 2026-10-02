## ADDED Requirements

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
