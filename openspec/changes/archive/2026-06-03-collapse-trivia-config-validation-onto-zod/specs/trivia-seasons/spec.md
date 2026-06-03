## ADDED Requirements

### Requirement: Season config validation is schema-driven

Validation of season config (`SeasonEntry` axis fields, `SeasonFormatSlot` slots, `format`, `slotOverrides`, and per-season `categories`/`theme`/`instructions`) SHALL reuse the same rich zod schemas that validate the game tier — shape and semantics in one definition per concept, with no parallel hand-rolled validator layer. The `upsert_season` tool path SHALL validate against these schemas via `safeParse` rather than calling separate `validate*` functions after zod.

#### Scenario: Season and game share the slot schema

- **WHEN** an invalid `SeasonFormatSlot` field is supplied to `upsert_season` (e.g. a `categories` array that dedupes to empty)
- **THEN** it is rejected by the identical slot schema used for game-tier slots, producing the same error wording, with no season-specific validator duplicating the rule

### Requirement: zod-to-Result formatter is a shared SDK-layer leaf

A dependency-free SDK-layer leaf module (`src/plugins/zodResult.ts`, importing only `zod`) SHALL export `zodErrorToResult(error, fieldLabel)` returning the canonical `Result<T>` shape, and it SHALL be the single formatter used to turn a `ZodError` into a labeled `{ ok: false; error }`. It SHALL be importable by both plugins and bot core, so downstream config-validation changes reuse it rather than redefining it. The duplicate trivia `Result<T>` / `ValidateResult<T>` declarations SHALL be removed in favor of importing it.

#### Scenario: One Result type across trivia config

- **WHEN** trivia config code returns a validation result
- **THEN** it uses the single `Result<T>` imported from `src/plugins/zodResult.ts`, and no trivia module redeclares its own `Result`/`ValidateResult` alias
