## 1. Type System

- [x] 1.1 Add `StaticFileResult` type (`string | { delete: true }`) and `static` field to `Migration` interface in `src/migrations/types.ts`
- [x] 1.2 Make `prompt` optional in the `Migration` interface

## 2. Engine

- [x] 2.1 Update `executeMigration()` in `src/migrations/engine.ts` to run `static` transforms before Claude — read files, call static function, write results / delete marked files
- [x] 2.2 Add Claude fallback path: if `static` throws and `prompt` exists, append error context and run Claude
- [x] 2.3 Skip Claude invocation entirely when `static` succeeds and no `prompt` is defined

## 3. Convert Existing Migrations

- [x] 3.1 Convert migration 001 (supportsChanges → access) to static: iterate repos, map `supportsChanges` boolean to `access` object, remove old key
- [x] 3.2 Convert migration 006 (remove ephemeral config + user preferences) to static: remove config fields, transform dmOptOut → reactionDelivery
- [x] 3.3 Convert migration 009 (add autoRespond) to static: add `autoRespond: { enabled: false }` if missing
- [x] 3.4 Convert migration 011 (add allowScheduledMessages) to static: add `allowScheduledMessages: false` if missing

## 4. Validation

- [x] 4.1 Run existing migration tests (`npx tsx scripts/migration-tests/run.ts`) — all tests must pass without modification
- [x] 4.2 Run TypeScript type check (`npx tsc`) — no type errors

## 5. Skill Update

- [x] 5.1 Update `/create-migration` skill to be aware of static migrations and scaffold them when the migration context involves JSON-only config changes
