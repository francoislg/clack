## MODIFIED Requirements

### Requirement: Auto-Respond Rule Persistence

The system SHALL persist standing auto-respond rules in `data/state/auto-respond.json` and ephemeral rules in `data/state/auto-respond-ephemeral.json`, with in-memory caching. `loadRules()` SHALL merge both sources (ephemeral first). Both readers SHALL be graceful/permissive zod loaders.

#### Scenario: Rule file structure
- **WHEN** rules are saved
- **THEN** the standing file contains a JSON object with a `rules` array
- **AND** each standing rule has: `id` (string), `channels` (string[]), `userFilters` (string[], optional), `keywords` (string[], optional), `extraContext` (string, optional), `preAnalysisContext` (string, optional), `enabled` (boolean)
- **AND** each ephemeral rule additionally has `kind: "ephemeral"`, `expiresAt` (number), `attentionLevel`, `sessionIds` (string[]), `anchorText` (string), and optionally `creationContext` (string; a legacy `followUpContext` field on already-persisted rules is read as `creationContext`)

#### Scenario: Load rules on first access
- **WHEN** rules are accessed for the first time
- **THEN** the system reads both `data/state/auto-respond.json` and `data/state/auto-respond-ephemeral.json`
- **AND** caches the merged result in memory
- **AND** returns an empty rules array if neither file exists

#### Scenario: Persist rules on change
- **WHEN** a rule is created, updated, or deleted
- **THEN** the system writes the updated rules to the file matching the rule's kind
- **AND** updates the in-memory cache

#### Scenario: Concurrent rule modifications
- **WHEN** two admins modify rules simultaneously
- **THEN** last-write-wins semantics apply
- **AND** each file is always valid JSON (no partial writes or corruption)

#### Scenario: Rollback safety
- **WHEN** a pre-change binary runs against state written by this change
- **THEN** it reads only `auto-respond.json` and never observes ephemeral rules
- **AND** no ephemeral rule can act as a standing match-everything channel rule

#### Scenario: Per-file corruption isolation
- **WHEN** one of the two files is corrupt or unparseable and the other is valid
- **THEN** `loadRules()` returns the valid file's rules, logs the failure, and treats the corrupt file as empty (graceful reader — never throws, never wipes the valid file)
