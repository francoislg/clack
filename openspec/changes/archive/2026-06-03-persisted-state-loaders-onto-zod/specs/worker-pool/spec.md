## ADDED Requirements

### Requirement: Worker-pool state loading is schema-driven

`workers/persistence.ts` SHALL parse `workers.json` against a zod schema (`WorkersState` with `version`, `workers[]`; `PersistedWorker` with enum `status` and ISO-date `lastUsedAt`/`createdAt` transformed to `Date`) instead of the hand-rolled `isObject`/`isStatus`/`isPersistedWorker`/`isWorkersState` type guards. Graceful degradation SHALL be preserved: on parse failure the loader logs a warning and returns an empty pool (it MUST NOT throw), and a valid file MUST parse to the identical in-memory shape including `Date` coercion.

#### Scenario: Corrupt state degrades, does not throw

- **WHEN** `workers.json` is malformed or fails the schema
- **THEN** the loader logs a warning and returns `[]` (empty pool), exactly as today — startup is unaffected

#### Scenario: Valid state round-trips with Date coercion

- **WHEN** a valid `workers.json` is loaded
- **THEN** every worker is returned with `status` validated and `lastUsedAt`/`createdAt` as `Date` objects, byte-equal to the pre-migration result

#### Scenario: Malformed date strings behave exactly as today

- **WHEN** a worker entry carries an unparseable `lastUsedAt`/`createdAt` string
- **THEN** the loader's handling matches the pre-migration `new Date(string)` behavior exactly (the schema's date transform MUST NOT newly reject an entry that the current loader accepts) — the characterization gate pins whether that yields an Invalid Date or drops the entry
