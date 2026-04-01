## 1. Cache Reset Exports

- [x] 1.1 Add `clearGitHubTokenCache()` export to `src/github.ts` (the only module missing a cache-clearing function; roles, userPreferences, autoRespond, and cronJobs already have `clear*Cache()` exports)

## 2. Always-Register Bolt Handlers

- [x] 2.1 Update `src/slack/app.ts` to register assistant, mention, auto-respond, and message-changed handlers unconditionally
- [x] 2.2 Add early-return config checks at invocation time in the assistant handler (`src/slack/handlers/assistant.ts`)
- [x] 2.3 Add early-return config check at invocation time in the mention handler (`src/slack/handlers/mention.ts`)
- [x] 2.4 Add early-return config check at invocation time in the auto-respond handler (`src/slack/handlers/autoRespond.ts`)
- [x] 2.5 Add early-return config check at invocation time in the message-changed handler (`src/slack/handlers/messageChanged.ts`) — return early if neither DMs nor mentions are enabled
- [x] 2.6 Update `src/slack/app.test.ts` to reflect always-register behavior

## 3. Lifecycle Module

- [x] 3.1 Create `src/lifecycle.ts` with `startAll()`, `restartAll()`, and `stopAll()` functions
- [x] 3.2 Refactor `src/index.ts` to delegate scheduler/watcher management to lifecycle module
- [x] 3.3 Add tests for `restartAll()` — config validation failure aborts without side effects, successful restart resets caches and restarts schedulers

## 4. Admin Config Tools

- [x] 4.1 Define the file path allowlist and validation helpers (shared module for tools, e.g. `src/tools/admin/allowlist.ts`)
- [x] 4.2 Implement `admin_read_file` tool in `src/tools/admin/adminReadFile.ts`
- [x] 4.3 Implement `admin_write_file` tool in `src/tools/admin/adminWriteFile.ts`
- [x] 4.4 Implement `admin_restart_app` tool in `src/tools/admin/adminRestartApp.ts` — calls `restartAll()` from lifecycle module
- [x] 4.5 Register admin tools in `src/tools/server.ts` gated by `canEditConfig(ctx.role)`
- [x] 4.6 Add tests for allowlist validation, read/write behavior, and validation rejection

## 5. Tool Mappings

- [x] 5.1 Add tool mapping config for `admin_read_file` — label should include the file path being read (e.g., "Reading config.json")
- [x] 5.2 Add tool mapping config for `admin_write_file` — label should include the file path being written (e.g., "Writing mcp.json")
- [x] 5.3 Add tool mapping config for `admin_restart_app` — static label (e.g., "Restarting app")

## 6. Home Tab Update

- [x] 6.1 Add admin config tools hint to the Configuration section of the Home Tab for admin/owner users

## 7. Integration Testing

- [x] 7.1 End-to-end test: write config.json via tool, restart, verify new config is active
- [x] 7.2 End-to-end test: write invalid config.json, verify rejection without file change
- [x] 7.3 End-to-end test: restart with new repository, verify clone is triggered
