## ADDED Requirements

### Requirement: Session loading/synthesis is schema-driven

`sessions.ts` SHALL recognize the three on-disk session eras (pre-unified-log, first-wave unified-log, current `trigger + messages`) via a zod input union whose `.transform()` chains perform the legacy→modern synthesis, replacing the imperative `synthesizeMessagesFromLegacy` + second-pass shape check. All three eras SHALL parse to the identical modern `LoadedSession` they produce today (trigger reconstruction, user-message source canonicalization, trigger-type normalization, default-filling), and genuinely corrupt files SHALL be quarantined exactly as today. The loader SHALL NOT throw.

#### Scenario: Each era synthesizes to the identical modern shape

- **WHEN** a session file from any of the three eras is loaded
- **THEN** the resulting `LoadedSession` is byte-equal to the pre-migration synthesis output, captured by the characterization gate

#### Scenario: Every individual synthesis transform is preserved

- **WHEN** a legacy file exercises a specific transform — trigger reconstruction from `originalQuestion`/`messages[0]`, user-message source canonicalization (`"initial"`/`"refinement"` → `"reply"`/`"choice"`/`"followup"`), trigger-type normalization (`"threadReply"` → `"autoRespond"`), missing-reaction-emoji defaulting, and `errors`/`threadContext`/`autoResponseActive` default-filling
- **THEN** each transform produces the identical result it does today, asserted per-transform by the characterization gate (not only the aggregate shape)

#### Scenario: Corrupt session is quarantined, not thrown

- **WHEN** a session file matches none of the era variants
- **THEN** it is quarantined and a warning logged, exactly as the pre-migration corrupt-file branch — no exception propagates

#### Scenario: Migration ships only on proven parity

- **WHEN** the characterization gate over all three eras + corrupt samples cannot be made to pass byte-for-byte
- **THEN** the schema migration is NOT shipped and the existing hand-rolled synthesis is retained
