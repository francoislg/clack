## ADDED Requirements

### Requirement: Migration 022 relocates TriviaConfig to plugin file

The system SHALL register a blocking boot migration `022-trivia-config-to-plugin.ts` that relocates `config.trivia` from `data/config.json` into a new plugin-owned file at `data/plugins/trivia/config.json`. The migration SHALL run before the trivia plugin's load function executes.

The migration SHALL perform these steps, in order:

1. **Idempotency check 1**: Read `data/config.json`. If the parsed object has no `trivia` field (or `trivia` is `undefined`/`null`), the migration SHALL exit successfully without writing anything.
2. **Conflict check**: Check whether `data/plugins/trivia/config.json` already exists AND parses as a non-empty object. If so, the migration SHALL exit WITHOUT writing and log a clear error directing the operator to manually reconcile the two sources.
3. **Copy**: Write `data/config.json`'s `trivia` block to `data/plugins/trivia/config.json` (creating the `data/plugins/trivia/` directory if missing). The write SHALL use `JSON.stringify(value, null, 2)` (pretty-printed, two-space indent).
4. **Delete**: Remove the `trivia` field from the parsed `data/config.json` object and rewrite the file (preserving the rest of the config with its existing formatting where possible).
5. **Log**: Emit a single-line confirmation identifying the source and destination paths.

The migration SHALL NOT touch `data/plugins/trivia/games/`, `data/plugins/trivia/categories.json`, `data/plugins/trivia/users.json`, or any other files outside the two it manages.

#### Scenario: Fresh deployment is a no-op

- **GIVEN** `data/config.json` has no `trivia` field
- **WHEN** migration 022 runs
- **THEN** no files are created or modified
- **AND** the migration exits successfully

#### Scenario: Standard relocation

- **GIVEN** `data/config.json` has `trivia: { games: [...], answersFormat: { boolean: 1 } }`
- **AND** `data/plugins/trivia/config.json` does not exist
- **WHEN** migration 022 runs
- **THEN** `data/plugins/trivia/config.json` is created with the `TriviaConfig` content as its top-level value
- **AND** `data/config.json` no longer has a `trivia` field
- **AND** the rest of `data/config.json` is preserved
- **AND** a confirmation is logged

#### Scenario: Already-migrated deployment is a no-op

- **GIVEN** `data/config.json` has no `trivia` field
- **AND** `data/plugins/trivia/config.json` already exists with content
- **WHEN** migration 022 runs
- **THEN** no files are modified
- **AND** the migration exits successfully

#### Scenario: Conflict exits without write

- **GIVEN** `data/config.json` has a `trivia` field
- **AND** `data/plugins/trivia/config.json` already exists with non-empty content
- **WHEN** migration 022 runs
- **THEN** neither file is modified
- **AND** the migration exits with a clear error message identifying both paths
- **AND** the migration version is NOT advanced (operator must resolve and rerun)

#### Scenario: Empty trivia block also relocates

- **GIVEN** `data/config.json` has `trivia: {}` (empty object)
- **WHEN** migration 022 runs
- **THEN** `data/plugins/trivia/config.json` is created with `{}` as its content
- **AND** `data/config.json`'s `trivia` field is removed

#### Scenario: Runs before plugin load

- **GIVEN** migration 022 is registered with `priority: "blocking"`
- **WHEN** the app boots
- **THEN** migration 022 runs to completion BEFORE the trivia plugin's `load` function executes
- **AND** the plugin observes the post-migration state of `data/config.json` and `data/plugins/trivia/config.json`
