## ADDED Requirements

### Requirement: config.json validation is schema-driven

`validateConfig` SHALL validate `config.json` against zod schemas (one per config section) that encode shape, semantics, AND defaults in a single definition, replacing the hand-rolled extractor helpers, `parse*` sub-functions, and scattered `?? DEFAULTS`. It SHALL retain fail-fast boot behavior: a malformed config aborts startup by throwing, and a valid config returns the fully-defaulted `Config`. The admin `validateContent` path (config.json) SHALL reuse the same schema rather than re-implementing checks. A characterization gate SHALL capture today's accept/reject behavior and thrown-error text across every rejection mode (invalid types, out-of-range values, enum violations, partial-but-valid configs) before migration; the schema-driven path SHALL reproduce them.

#### Scenario: Malformed config still aborts startup

- **WHEN** `config.json` contains an invalid field (e.g. a non-integer `submitResponse.maxAdditionalMessages` or an out-of-range value)
- **THEN** `validateConfig` throws an error identifying the field, equivalent to the pre-migration message, and startup does not proceed

#### Scenario: Defaults are applied identically

- **WHEN** a partial but valid `config.json` (omitting fields that have defaults) is validated
- **THEN** the returned `Config` is byte-equal to the pre-migration result, with the same default values filled

#### Scenario: Admin config-file validation reuses the schema

- **WHEN** an admin edits `config.json` via the config tools and the content is validated
- **THEN** acceptance/rejection matches `validateConfig` exactly (one schema, no second validator), and the `ValidationResult { valid; error? }` envelope is preserved

