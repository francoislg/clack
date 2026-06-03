## ADDED Requirements

### Requirement: User-preferences loading is schema-driven

`userPreferences.ts` SHALL parse the preferences map against a zod schema (`Record<userId, Partial<UserPreferences>>`) instead of a bare `JSON.parse` + type assertion. The deprecated `dmOptOut` field SHALL be accepted (`.optional()`) for backward compatibility but not surfaced into the runtime type. On parse failure it SHALL return `{}` and per-key defaults SHALL apply on read, exactly as today (log + fallback, never throw).

#### Scenario: Deprecated dmOptOut is accepted, not surfaced

- **WHEN** a stored preferences file still contains `dmOptOut`
- **THEN** the file parses successfully and `dmOptOut` does not appear in the runtime preferences (other fields read with their current defaults)

#### Scenario: Corrupt preferences degrade to empty

- **WHEN** the preferences file is malformed or fails the schema
- **THEN** the loader returns `{}` and reads fall back to `DEFAULT_PREFERENCES`, exactly as today
