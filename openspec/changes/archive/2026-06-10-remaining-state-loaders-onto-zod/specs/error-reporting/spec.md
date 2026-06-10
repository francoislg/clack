## ADDED Requirements

### Requirement: Error-report load is schema-driven

`readErrorReport` SHALL validate a persisted error report against an `ErrorReport` zod schema rather than a blind `JSON.parse(content) as ErrorReport` cast, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL return `null`, never throw. This loader has no test today; a loader test SHALL be added with the migration to gate the behavior.

#### Scenario: Corrupt report degrades to null

- **WHEN** an error-report file is absent, not valid JSON, or fails schema validation
- **THEN** `readErrorReport` returns `null`

#### Scenario: A valid report round-trips

- **WHEN** a well-formed error report is read
- **THEN** the parsed `ErrorReport` matches the pre-migration result
