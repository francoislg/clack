## Why

Every migration currently invokes Claude via the Agent SDK, even for trivial JSON transforms like adding a single boolean field to config.json. This adds unnecessary latency and cost at boot time. Deterministic data transforms (add field, rename key, remove property) don't require AI judgment and can execute as plain TypeScript functions in milliseconds.

## What Changes

- Add optional `static` function to the `Migration` interface as an alternative (or complement) to the Claude `prompt`
- Make `prompt` optional — static-only migrations don't need one
- Update `executeMigration()` to run static transforms before Claude, or instead of Claude when no prompt exists
- If a static transform throws and a `prompt` is present, fall back to Claude with error context
- Add explicit delete sentinel (`{ delete: true }`) to the static return type for file deletion
- Convert 4 existing JSON-only migrations (001, 006, 009, 011) to use static transforms
- Update the `/create-migration` skill to scaffold static migrations when appropriate

## Capabilities

### New Capabilities

_None — this extends an existing capability._

### Modified Capabilities

- `boot-migrations`: The migration execution requirement changes from "always use Claude" to "use static transforms when possible, Claude when needed, or both." Adds a new execution path that bypasses the Agent SDK for deterministic transforms.

## Impact

- **`src/migrations/types.ts`** — `Migration` interface gains `static` field, `prompt` becomes optional
- **`src/migrations/engine.ts`** — `executeMigration()` gains static transform execution path with Claude fallback on error
- **`src/migrations/001-*.ts`** — converted to static (supportsChanges → access mapping)
- **`src/migrations/006-*.ts`** — converted to static (remove ephemeral config + preference migration)
- **`src/migrations/009-*.ts`** — converted to static (add autoRespond field)
- **`src/migrations/011-*.ts`** — converted to static (add allowScheduledMessages field)
- **`.claude/skills/create-migration/`** — updated to scaffold static migrations
- **`scripts/migration-tests/`** — test runner and test files unchanged (backward compatibility)
- **Markdown-based migrations (002-005, 007, 008, 010)** — unchanged, continue using Claude
