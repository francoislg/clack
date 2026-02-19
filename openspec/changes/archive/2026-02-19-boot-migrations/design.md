## Context

Clack is a self-hosted Slack bot. When the project evolves (config schema changes, new required files, data format shifts), there's no mechanism to detect or apply these changes. Operators must manually figure out what changed between versions.

The current boot sequence in `src/index.ts` follows: load config → validate GitHub → validate instructions → test MCP → init repos → init worktrees → start schedulers → start Slack app. Migrations need to slot into this sequence.

## Goals / Non-Goals

**Goals:**
- Detect pending migrations at boot by comparing a version counter
- Execute blocking migrations before Clack becomes available
- Execute enhancement migrations asynchronously after boot
- Use Claude to perform migrations with scoped file access
- Interact with admin via DM when Claude needs human input
- Show migration errors on home tab when DMs are unavailable
- Advance version per-migration for crash safety
- Hot-reload config after enhancement migrations
- Provide a `create-migration` Claude Code skill for developers

**Non-Goals:**
- Database migrations (Clack uses file-based state only)
- Rollback support (migrations are forward-only; fix with a new migration)
- Web UI for migration management
- Automatic version detection from git tags or package.json

## Decisions

### Version tracking: integer counter in `data/state/version.json`

A simple `{ "version": 3 }` file. Starts at 0 for fresh installs. Each migration targets a specific version number. Compare current version against the highest migration version to detect pending work.

**Why not semver?** Migrations are sequential and ordered. An integer counter is simpler, avoids parsing, and maps directly to "run migrations 4, 5, 6" logic.

**Why a separate file (not in config)?** The version tracks internal state, not user configuration. Keeping it in `data/state/` separates concerns and avoids config file churn.

### Migration registry: files in `src/migrations/`

Each migration is a TypeScript file exporting a `Migration` object:

```typescript
interface Migration {
  version: number;          // Target version after this migration
  name: string;             // Human-readable name
  priority: "blocking" | "enhancement";
  prompt: string;           // Prompt for Claude to execute the migration
  files: string[];          // Files Claude can read/write (scoped access)
}
```

An `index.ts` barrel exports all migrations in order. This is code, not data — migrations ship with the codebase and are version-controlled.

**Why Claude-powered?** Migrations often require judgment (restructuring config, mapping old values to new schemas). Claude can handle ambiguous transformations that a deterministic script can't. If the migration is trivial, the prompt is trivial too — no overhead.

### Two-phase execution: blocking before boot, enhancement after boot

**Blocking migrations** (`priority: "blocking"`):
- Run after config load but before Slack app starts
- If they fail, Clack does not start (exits with error)
- Example: config schema changes that prevent loading

**Enhancement migrations** (`priority: "enhancement"`):
- Run asynchronously after Clack is fully booted
- Clack operates normally while these run
- On completion, trigger hot config reload if needed
- Example: adding optional config fields, restructuring data files

Migrations run in version order regardless of priority — if migration 4 is blocking and 5 is enhancement, 4 runs first at boot, then 5 runs after boot.

### Claude execution with scoped file access

The migration engine spawns Claude with:
- The migration's `prompt` as the user message
- System instructions explaining the migration context
- Read/write access scoped to the migration's `files` array
- Access to the current file contents for context

Claude reads the files, applies the transformation, and writes the results. The engine validates that Claude only touched allowed files.

### Admin interaction: DM first, home tab fallback

When Claude encounters ambiguity during migration:
1. **Try DM**: Send the admin a message explaining the situation and asking for input. Wait for response with a timeout.
2. **Home tab fallback**: If DM fails (admin hasn't opened a DM with the bot, or timeout), mark the migration as failed and display a banner on the home tab explaining the issue.

Admin identification: use the owner role from the roles system. If no owner, fall back to first admin.

### Per-migration version bumps

After each successful migration, immediately write the new version to `data/state/version.json`. If Clack crashes mid-sequence, it resumes from the last successful migration on next boot — no re-running completed work.

### Create-migration skill

A Claude Code skill (`/create-migration`) that scaffolds a new migration file:
- Reads existing migrations to determine next version number
- Asks what the migration should do
- Generates the migration file with appropriate prompt, priority, and file scope
- Registers it in the barrel export

## Risks / Trade-offs

**[Claude execution is non-deterministic]** → Migrations include file scope limits. The engine validates output. For critical migrations, the prompt can be very specific ("change key X from Y to Z"). Enhancement migrations tolerate more flexibility.

**[Admin might not respond to DM]** → Timeout after configurable duration, then surface on home tab. Blocking migrations that need input will prevent boot — this is intentional (the migration is blocking for a reason).

**[Migration order matters across priorities]** → Run strictly by version number. A blocking migration at version 5 runs before an enhancement at version 6, even though enhancements are normally deferred. This keeps the version sequence clean.

**[Fresh installs need bootstrapping]** → If `data/state/version.json` doesn't exist, assume version 0. Migrations designed for upgrading won't break fresh installs because they check for the existence of files they modify.
