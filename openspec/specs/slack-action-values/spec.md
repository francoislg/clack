# slack-action-values Specification

## Purpose
TBD - created by archiving change slack-payload-schemas-onto-zod. Update Purpose after archive.
## Requirements
### Requirement: Encoded button action-value decode is schema-driven

The encoded button-value wire format (`{ s, r, v, p, h, w, c, t, sn }`) SHALL be defined by a single `EncodedActionValue` zod schema co-located with `encodeActionValue` / `decodeActionValue`. `decodeActionValue` SHALL parse the value through that schema instead of hand-rolled per-field `typeof` checks, while preserving its exact contract: the returned object (`sessionId`, `ref`, `choiceValue`, `prompt`, `hint`, `workMode`, `targetChannel`, `targetThreadTs`, `snapshotId`) is unchanged, and a non-encoded string still falls back to `{ sessionId: value }`.

#### Scenario: Encoded values round-trip unchanged

- **WHEN** a button value produced by `encodeActionValue` (for any `Action` type) is decoded
- **THEN** `decodeActionValue` returns the same fields it returns today, field-for-field

#### Scenario: Non-encoded value falls back to sessionId

- **WHEN** a button value is a bare string (not encoded JSON) or fails schema parsing
- **THEN** `decodeActionValue` returns `{ sessionId: value }`, exactly as the pre-migration fallback

