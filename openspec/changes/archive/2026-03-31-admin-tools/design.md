## Context

Admins can edit instruction files (`.md` in `data/configuration/`) via the Home Tab and the `propose_config_update` tool, but cannot edit core infrastructure files (`config.json`, `mcp.json`, `auth/.env`, `tool_mapping/*.json`) without SSH access. The `config.json` file specifically requires a process restart after manual edits. The bot already has file watchers for `mcp.json` and `.env` that invalidate caches on change, but `config.json` is loaded once at startup and cached.

The Slack socket connection (Bolt App + Socket Mode) is stable infrastructure that doesn't need recycling on config changes. All other state — caches, schedulers, repo clones — can be torn down and rebuilt around it.

## Goals / Non-Goals

**Goals:**
- Admins can read and write core config files via Claude conversation tools
- Admins can trigger a soft restart that reloads all config without dropping the Slack connection
- Centralize app lifecycle management (cache resets, scheduler start/stop) in one module
- Bolt handlers are always registered; enablement is checked at invocation time

**Non-Goals:**
- No new Home Tab UI for these files — editing happens through conversation
- No schema editor or form-based config editing — Claude reads/writes the raw files
- No partial hot-reload (e.g., "only reload repositories") — restart is all-or-nothing
- No changes to the existing instruction file editing system (`propose_config_update`, Home Tab modals)

## Decisions

### 1. Allowlisted file paths for admin tools

The `admin_read_file` and `admin_write_file` tools operate on a static allowlist of file paths relative to `data/`:

- `config.json`
- `mcp.json`
- `auth/.env`
- `configuration/tool_mapping/*.json` (glob — any JSON file in the tool_mapping override dir)

**Why not a generic "any file in data/" approach:** Too broad. Files like `auth/slack.json`, `auth/github.json`, and `auth/github-app.pem` contain secrets that shouldn't be readable through conversation tools. The allowlist is explicit and auditable.

**Why not per-file tools:** The behavior is identical across files (read content, write content with validation). A single tool with a path parameter keeps the tool count low and lets Claude figure out which file from conversation context.

### 2. Validation on write

`admin_write_file` validates content before writing:

- **`config.json`**: Parse as JSON, run through `validateConfig()`. Reject on validation failure with the error message. This reuses the existing thorough validation (repo structure, role enums, hex colors, etc.). Note: `validateConfig()` requires `SlackAuthConfig` — read it from `auth/slack.json` as `loadConfig()` already does.
- **`mcp.json`**: Parse as JSON. Structural validation (must have `mcpServers` object) but no deep validation of server configs — those are validated at connection time.
- **`auth/.env`**: Basic syntax check — each non-empty, non-comment line must match `KEY=VALUE` format.
- **`tool_mapping/*.json`**: Parse as JSON. No deep structural validation.

**Why validate before write:** A broken `config.json` would prevent the app from restarting. Validation catches this before the file hits disk.

### 3. Soft restart via lifecycle module

Extract `src/lifecycle.ts` with three functions:

```
startAll(app)       — called from index.ts after Bolt app starts
restartAll(app)     — called from admin_restart_app tool
stopAll()           — called from shutdown signal handler
```

`restartAll()` sequence:
1. Reload env vars (`dotenv` with override)
2. Reload config (`loadConfig(undefined, true)`) — if this fails, abort and throw without touching anything
3. Stop all schedulers, watchers, config watcher, and completion monitor
4. Reset all module caches (MCP, tool mappings, roles, user prefs, github token, auto-respond, cron jobs)
5. Reload GitHub credentials (`loadGitHubCredentials()`)
6. Validate instruction files
7. Initialize + sync repositories (clones new repos, pulls existing)
8. Ensure worktree directories
9. Restart all schedulers, watchers, config watcher, completion monitor, and cron scheduler

The Bolt App instance is passed as a parameter but **not** restarted — the socket stays connected.

**Why not `process.exit(0)`:** The admin's session is running through the Bolt socket. Killing the process would drop the response. A soft restart lets the tool return success, and the admin sees confirmation in-thread.

### 4. Always-register Bolt handlers

Move `if (config.directMessages.enabled)` / `if (config.mentions.enabled)` / `if (config.autoRespond?.enabled)` checks from `createSlackApp()` (registration time) to handler invocation time.

All handlers are registered unconditionally. Each handler reads `getConfig()` at invocation time and returns early if its feature is disabled. This means a soft restart that enables DMs or mentions takes effect immediately without re-creating the Bolt App.

**Why this is safe:** The early-return config check in each handler has negligible overhead. When a feature is disabled, the handler fires but exits immediately before any processing. This is simpler and more maintainable than conditionally registering handlers and trying to add/remove them at restart time.

**Alternative considered:** Re-create the Bolt App on restart. Rejected because it requires disconnecting and reconnecting the socket, which drops in-flight sessions and causes a brief outage.

### 5. Cache reset exports

Most modules already export cache-clearing functions. The lifecycle module will use these existing exports:

| Module | Existing export | Status |
|--------|----------------|--------|
| `roles.ts` | `clearRolesCache()` | Already exists |
| `userPreferences.ts` | `clearPreferencesCache()` | Already exists |
| `autoRespond.ts` | `clearAutoRespondCache()` | Already exists |
| `cronJobs.ts` | `clearCronJobsCache()` | Already exists |
| `mcp.ts` | `resetMcpCache()` | Already exists |
| `toolMappingLoader.ts` | `resetToolMappingCache()` | Already exists |
| `config.ts` | `loadConfig(_, true)` | Already exists |
| `github.ts` | — | **Needs new `clearGitHubTokenCache()` export** |

Only `github.ts` needs a new export. The `cachedToken` variable has no clearing function today.

### 6. No confirmation flow for admin file writes

Unlike `propose_config_update` (which stages an intent and waits for a Slack button click), `admin_write_file` writes immediately on invocation. The admin is the one asking Claude to make the change — the conversation itself is the confirmation.

**Why different from instruction file edits:** Instruction files affect all users' Claude experience. Config files affect infrastructure. The admin requesting the change is the authority for both, but config changes are more targeted and less likely to have unintended effects on other users' conversations.

## Risks / Trade-offs

- **[In-flight sessions during restart]** → Sessions that started before the restart continue with their already-built tool server and system prompt. The restart only affects new sessions. This is acceptable — config changes are not expected to take effect mid-conversation.

- **[New repo clone during restart]** → If an admin adds a repository to `config.json` and restarts, `initializeRepositories()` will clone it. This could take time for large repos. The tool should report that the restart is in progress and may take a moment. The tool response returns before the clone completes — schedulers and other state are already reset.

- **[Broken config recovery]** → If `admin_write_file` validation has a bug and writes a broken config, `restartAll()` will fail. The tool should catch this and report the error without leaving the app in a half-restarted state. Sequence the restart so that config reload + validation happens first, before stopping schedulers.

- **[`.env` secrets visible to Claude]** → `admin_read_file` on `auth/.env` exposes API tokens to Claude's context. This is acceptable for admin-only access but worth noting. The tokens are already in the bot's memory at runtime.
