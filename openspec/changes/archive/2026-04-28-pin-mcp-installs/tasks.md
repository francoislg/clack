## 1. Schema and Validation

- [x] 1.1 Add `package?: string` and `version?: string` fields to the stdio MCP entry type used by `data/mcp.json` parsing in `src/mcp.ts`
- [x] 1.2 Add validation: if exactly one of `package`/`version` is set, throw a config error identifying the entry name and the missing field
- [x] 1.3 Add unit tests for the schema validation cases (both present, only `package`, only `version`, neither)

## 2. Installer

- [x] 2.1 Create `src/mcpInstaller.ts` exporting `ensureInstalled(name: string, pkg: string, version: string): Promise<{ binPath: string }>`
- [x] 2.2 Implement install dir resolution: `data/mcp_packages/<name>/`
- [x] 2.3 Implement version-drift check: read `<dir>/node_modules/<pkg>/package.json#version`; if missing or mismatched, `rm -rf <dir>` and reinstall
- [x] 2.4 Implement install: shell out to `npm install --install-strategy=nested --prefix <dir> <pkg>@<version>`, capture stderr, throw on non-zero exit
- [x] 2.5 Implement bin resolution: read `<dir>/node_modules/<pkg>/package.json#bin`; handle string form, object form (extract the unscoped name from `<pkg>` — strip the leading `@scope/` if present — match against object keys, fall back to first entry), and missing form (throw)
- [x] 2.6 Add unit tests for `ensureInstalled` covering: fresh install, version match (no-op), version drift (reinstall), install failure, all three `bin` shapes (string, object-with-match — including a scoped package like `@roychri/mcp-server-asana` matching the `mcp-server-asana` bin key, object-without-match), missing `bin`

## 3. Loader Integration

- [x] 3.1 In `src/mcp.ts`, branch `loadMcpServer(name)` and the relevant always-on path: when an entry has `package`+`version`, call `ensureInstalled` and return `{ command: "node", args: [binPath], env: entry.env }`
- [x] 3.2 When `package` is absent and `command === "npx"`, log a one-time warning per server name (memoized in process memory): `MCP '<name>' uses npx — consider migrating to package/version for reliable installs`
- [x] 3.3 When `package` is absent and `command !== "npx"`, pass through with no warning
- [x] 3.4 Add unit tests for the loader branches: pinned path returns node-binary spawn config, npx path warns once and returns original config, non-npx legacy command is silent

## 4. Boot Sequence

## 4. Boot Sequence

- [x] 4.1 In `src/index.ts`, add a step between config load and `testMCP` that iterates entries where both `package` and `version` are set (post-validation from task 1.2) and calls `ensureInstalled` for each
- [x] 4.2 On install failure for a pinned entry: log the error, mark the entry as failed via `setFailedMcpServers`, and continue startup (do not crash)
- [x] 4.3 Add a startup smoke test that exercises the boot sequence: (1) one pinned entry with a matching installed version (no-op), (2) one pinned entry with version drift (reinstalls), (3) one legacy npx entry (skipped, install not invoked)

## 5. Migration of Asana and Sentry

- [x] 5.1 Update `data/mcp.json` (and `data/mcp.json.example` if present) to pin `asana` to `@roychri/mcp-server-asana@1.8.0`
- [x] 5.2 Update `data/mcp.json` to pin `sentry` to `@sentry/mcp-server@0.33.0`
- [x] 5.3 Add `data/mcp_packages/` to `.gitignore`

## 6. Docs

- [x] 6.1 Update `docs/asana-integration.md` to show the new pinned shape with `package` + `version` instead of `command: "npx"`
- [x] 6.2 Add a short section to the same doc (or a new `docs/setup-mcp-servers.md` if no general doc exists yet) explaining the pinned-install model: where files go, how to bump a version, how to nuke and reinstall

## 7. Validation

- [x] 7.1 Run `npx tsc` — no type errors
- [x] 7.2 Run `npm run test` — all existing and new tests pass
- [x] 7.3 Manually verify: with `asana` pinned, restart the bot, watch logs for the install step succeeding, then exercise an attach in a Slack thread and confirm the spawn succeeds (no `Cannot find module @exodus/bytes` error)
- [x] 7.4 Manually verify the same for `sentry`
- [x] 7.5 Manually verify a legacy npx entry (e.g., `metabase`) still works and emits the migration warning exactly once
