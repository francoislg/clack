## ADDED Requirements

### Requirement: Auto-respond rules load is schema-driven

`loadRules` SHALL parse `auto-respond` state against an `AutoRespondState` zod schema rather than a blind `JSON.parse(content) as Partial<AutoRespondState>` cast, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL log and return `[]` (no rules), never throw. Optional/legacy fields SHALL be modeled so existing on-disk state round-trips.

#### Scenario: Corrupt state degrades to no rules

- **WHEN** the auto-respond state file is absent, not valid JSON, or fails schema validation
- **THEN** `loadRules` returns `[]` and logs, exactly as today

#### Scenario: Existing saved rules load unchanged

- **WHEN** a state file written by a prior build (including partial/optional fields) is loaded
- **THEN** the returned `AutoRespondRule[]` is identical to the pre-migration result
