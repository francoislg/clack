# memory-faculty — delta

## ADDED Requirements

### Requirement: Replaced-entry feedback on remember

When a `remember` call overwrites an existing entry's `what` (the argument was explicitly provided and a prior entry existed), the tool result SHALL include a `replaced: { previousWhatLength, newWhatLength }` field alongside the existing `{ ok, id, updatedAt }`. When the overwrite is a drastic shrink — previous `what` longer than 500 characters AND new `what` shorter than 25% of the previous length — the result SHALL additionally carry a `warning` string telling the caller it may have unintentionally replaced a full-bodied entry with a summary and to re-issue the full content if so. The feedback SHALL be generic (computed for every id, with no special-casing of setup-memory id patterns), advisory (the write always succeeds — replace semantics are unchanged), and absent when no prior entry existed or `what` was omitted (omit-keeps-prior produces no `replaced` block). `rememberCore` SHALL expose the previous entry to the tool layer; the threshold constants and warning phrasing live in the tool.

#### Scenario: Overwrite echoes replaced lengths

- **GIVEN** an entry whose `what` is 3,000 characters
- **WHEN** `remember` is called with the same id and a new 2,800-character `what`
- **THEN** the result includes `replaced: { previousWhatLength: 3000, newWhatLength: 2800 }` and no `warning`

#### Scenario: Drastic shrink warns

- **GIVEN** an entry whose `what` is 3,000 characters
- **WHEN** `remember` is called with the same id and a 90-character `what`
- **THEN** the write succeeds, and the result carries `replaced` plus a `warning` that a full-bodied entry may have been unintentionally summarized

#### Scenario: Small entries never warn

- **GIVEN** an entry whose `what` is a 120-character one-liner
- **WHEN** `remember` overwrites it with a 20-character `what`
- **THEN** the result includes `replaced` but no `warning`, the previous length being under the 500-character floor

#### Scenario: Boundary values do not warn

- **GIVEN** an entry whose `what` is exactly 500 characters
- **WHEN** `remember` overwrites it with a 100-character `what`
- **THEN** no `warning` is emitted, 500 not being strictly greater than the floor
- **GIVEN** an entry whose `what` is 1,000 characters
- **WHEN** `remember` overwrites it with a 250-character `what` (exactly 25%)
- **THEN** no `warning` is emitted, the new length not being strictly below a quarter of the previous

#### Scenario: First create and omitted what produce no feedback

- **WHEN** `remember` is called with a new id, or with an existing id but no `what` argument
- **THEN** the result contains no `replaced` field and no `warning`

### Requirement: what field permits living-document bodies

The `remember` tool's `what` argument description SHALL NOT assert a one-line statement as the universal shape: it SHALL present one line as the usual convention while explicitly permitting living-document entries (such as repo setup recipes) to store their full markdown body in `what`. This keeps the schema consistent with prompt directives that require full-bodied `what` content, so the schema description does not prime callers into summarizing entries that must hold complete documents.

#### Scenario: Schema does not contradict full-body directives

- **GIVEN** a prompt directive instructing Claude to store a complete markdown recipe in `what`
- **WHEN** Claude reads the `remember` tool schema before calling it
- **THEN** the `what` description permits a full markdown body for living-document entries and does not instruct a one-line summary as the only valid shape
