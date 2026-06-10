## ADDED Requirements

### Requirement: Skill-plugin manifest read is schema-driven

Skill-plugin discovery SHALL parse a plugin's manifest JSON against a narrow zod schema rather than a blind `as` cast, preserving its graceful contract: a missing/unreadable/invalid manifest SHALL fall back to the current defaults (name = directory basename, skill count = 0), never throw.

#### Scenario: Missing or malformed manifest falls back to defaults

- **WHEN** a skill plugin has no manifest, an unreadable manifest, or one that fails schema validation
- **THEN** discovery uses the directory basename as the name and a zero skill count, exactly as today

#### Scenario: A valid manifest is read unchanged

- **WHEN** a well-formed plugin manifest is present
- **THEN** the discovered plugin info matches the pre-migration result
