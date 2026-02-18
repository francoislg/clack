## 1. Version Tracking

- [x] 1.1 Create `src/migrations/types.ts` with `Migration` interface (version, name, priority, prompt, files) and `MigrationState` type
- [x] 1.2 Create `src/migrations/version.ts` — read/write `data/state/version.json`, default to 0 if missing, create `data/state/` directory if needed
- [x] 1.3 Create `src/migrations/index.ts` barrel that exports an empty migrations array (to be populated as migrations are added)

## 2. Migration Engine

- [x] 2.1 Create `src/migrations/engine.ts` — `getPendingMigrations(currentVersion, migrations)` returns migrations with version > current, sorted ascending
- [x] 2.2 Add `executeMigration(migration)` — invoke Claude with the migration prompt, system instructions, and scoped file access (read/write limited to migration's files array)
- [x] 2.3 Add per-migration version bump — after each successful migration, write new version to state file before proceeding to next

## 3. Admin Interaction

- [x] 3.1 Add `getAdmin()` helper — returns owner from roles system, falls back to first admin
- [x] 3.2 Add `dmAdmin(message)` — sends a DM to the admin, returns success/failure. Reuse existing Slack client patterns
- [x] 3.3 Add migration failure handling — on failure, attempt DM to admin with migration name and error; if DM fails, store error for home tab banner

## 4. Boot Integration

- [x] 4.1 Create `src/migrations/boot.ts` — `runBlockingMigrations()` that loads version, finds pending blocking migrations (in version order), executes them sequentially, exits on failure
- [x] 4.2 Create `runEnhancementMigrations()` — runs pending enhancement migrations asynchronously, hot-reloads config on completion
- [x] 4.3 Integrate into `src/index.ts` — call `runBlockingMigrations()` after config load (before Slack app starts), call `runEnhancementMigrations()` after Slack app starts

## 5. Home Tab Migration Banner

- [x] 5.1 Add migration error state — a module-level store for failed migration info (name, error message) that the home tab can read
- [x] 5.2 Modify `src/slack/homeTab.ts` — add a warning banner section at the top when migration errors exist, showing migration name and error summary
- [x] 5.3 Show resolution guidance for admin/owner users in the banner

## 6. Config Hot Reload

- [x] 6.1 Add `reloadConfig()` function to `src/config.ts` (or reuse `loadConfig()`) that re-reads config from disk and updates the in-memory config
- [x] 6.2 Call `reloadConfig()` in `runEnhancementMigrations()` after a migration that touches config files completes

## 7. Create-Migration Skill

- [x] 7.1 Create Claude Code skill definition for `create-migration` — reads existing migrations to determine next version, scaffolds a new migration file, updates the barrel export
