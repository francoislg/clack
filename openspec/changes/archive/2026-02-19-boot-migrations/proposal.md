## Why

Self-hosted Clack instances have no upgrade path when the project evolves. Config schemas change, new files are required, and data formats shift — but there's no mechanism to detect or apply these changes. Operators must manually figure out what changed between versions, leading to broken boots and confusion.

## What Changes

- Add an integer version counter tracked in `data/state/version.json`
- Add a migration registry (`src/migrations/`) where each migration declares its version, priority (blocking vs enhancement), and a Claude-powered execution prompt
- At boot, compare current version against latest migration version to detect pending migrations
- **Blocking migrations** run before Clack starts accepting Slack events — these fix breaking changes
- **Enhancement migrations** run asynchronously after boot — these improve config or data without breaking functionality
- Claude executes migrations with scoped file read/write access, using the migration's prompt
- If Claude needs human input during migration: DM the admin; if DMs unavailable, show error banner on home tab
- Per-migration version bumps for crash safety (version advances after each successful migration, not all at once)
- Hot config reload after enhancement migrations complete
- Add a `create-migration` Claude Code skill for developers to scaffold new migrations

## Capabilities

### New Capabilities
- `boot-migrations`: Version tracking, migration registry, execution engine (blocking + enhancement), admin interaction, and crash-safe version advancement

### Modified Capabilities
- `home-tab`: Add migration status/error banner when migrations are pending or failed
- `error-reporting`: Support migration-specific error reporting via admin DM and home tab

## Impact

- **New files**: `src/migrations/` directory, `src/migrationEngine.ts`, migration skill definition, `data/state/version.json`
- **Modified**: Boot sequence (`src/index.ts`), home tab (`src/slack/homeTab.ts`), error reporting
- **Dependencies**: Uses existing Claude Code integration for execution, existing Slack client for admin DMs
- **Config**: No config schema changes — migrations handle config evolution transparently
