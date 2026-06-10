## ADDED Requirements

### Requirement: User-skill metadata load is schema-driven

`readMeta` SHALL validate a user skill's `.meta.json` against a `UserSkillMeta` zod schema rather than the hand-rolled `isValidMetaShape` guard, preserving its graceful contract: a missing file, invalid JSON, or shape mismatch SHALL return `null`, never throw. The slug and description write-time rules (`validateSlug`, `validateDescription`) MAY be expressed as reusable `z.string()` constraints shared with the meta schema, keeping their current accept/reject behavior and `ValidationResult` envelope.

#### Scenario: Corrupt meta degrades to null

- **WHEN** a skill's `.meta.json` is absent, not valid JSON, or fails schema validation
- **THEN** `readMeta` returns `null` exactly as today

#### Scenario: Slug/description validation is unchanged

- **WHEN** a slug or description is validated at write time
- **THEN** the same inputs are accepted/rejected as before, and the `ValidationResult { ok; error? }` envelope is preserved
