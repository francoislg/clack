## Why

Admins currently cannot manage core configuration files (`config.json`, `mcp.json`, `auth/.env`, `tool_mapping/*.json`) at runtime. These require manual SSH/file access and — for `config.json` — a full process restart. This creates a gap where admins can edit instruction files from Slack but not the infrastructure they sit on top of.

## What Changes

- Add `admin_read_file` tool: read any editable config file (config.json, mcp.json, auth/.env, tool_mapping configs)
- Add `admin_write_file` tool: write to those files with validation (JSON parse, `validateConfig()` for config.json, dotenv syntax for .env)
- Add `admin_restart_app` tool: soft restart that resets all caches, reloads config, restarts schedulers, and re-syncs repos — without cycling the Slack socket connection
- Extract a `src/lifecycle.ts` module that centralizes cache resets and scheduler start/stop into `startAll()` / `restartAll()` / `stopAll()`
- Move Bolt handler registration to always-register pattern: check `config.*.enabled` at invocation time instead of registration time, so soft restarts can pick up handler enablement changes without reconnecting
- Add `clearGitHubTokenCache()` export to `github.ts` (the only module missing a cache-clearing function; roles, userPreferences, autoRespond, and cronJobs already have `clear*Cache()` exports)

## Capabilities

### New Capabilities
- `admin-config-tools`: MCP tools for admins to read and write core configuration files (config.json, mcp.json, auth/.env, tool_mapping configs) with validation
- `app-lifecycle`: Centralized app lifecycle management with soft restart capability — cache resets, scheduler cycling, repo sync — without dropping the Slack socket

### Modified Capabilities
- `clack-tools`: New admin-gated tools (`admin_read_file`, `admin_write_file`, `admin_restart_app`) added to the tool server
- `home-tab`: Status section should reflect that admin config editing is available via chat (informational, no new UI)

## Impact

- **New files**: `src/lifecycle.ts`, `src/tools/admin/allowlist.ts`, `src/tools/admin/adminReadFile.ts`, `src/tools/admin/adminWriteFile.ts`, `src/tools/admin/adminRestartApp.ts`
- **Modified files**: `src/index.ts` (delegate to lifecycle), `src/slack/app.ts` (always-register handlers), `src/tools/server.ts` (register admin tools), `src/config.ts` / `src/roles.ts` / `src/userPreferences.ts` / `src/github.ts` / `src/autoRespond.ts` / `src/cronJobs.ts` (add reset exports)
- **No new dependencies**
- **No breaking changes** — existing admin instruction editing is untouched
