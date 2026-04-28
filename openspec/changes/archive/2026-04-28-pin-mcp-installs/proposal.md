## Why

Asana and Sentry MCP servers are dead because `npx -y` triggers an npm 10 hoisting bug for their dependency trees: a partial top-level copy of a transitive package (`@exodus/bytes` for asana, `@opentelemetry/api` for sentry) shadows the working nested copy, and every spawn crashes with `Cannot find module …` on first use. Clearing the cache reproduces the same broken hoist on reinstall — the bug is deterministic for these dep shapes. The fix is to stop using `npx -y` and install each MCP into its own isolated, hoist-disabled directory pinned to a specific version.

## What Changes

- **stdio MCP entries in `data/mcp.json` gain `package` + `version` fields.** When both are set, clack runs `npm install --install-strategy=nested --prefix data/mcp_packages/<name> <package>@<version>` and spawns `node <resolved-bin>` instead of `npx -y`.
- **`--install-strategy=nested` disables npm hoisting**, giving each package its own private `node_modules` tree. The shadow-stub class of bugs cannot occur.
- **Old shape (`command: "npx"`, `args: ["-y", "<pkg>"]`) keeps working** — emits a one-time migration warning per server at boot. Opt-in, no forced cutover.
- **HTTP/SSE entries pass through unchanged** — they don't install anything.
- **Validation:** boot fails fast if `package` is set but `version` is missing (or vice versa) — a partial pin is a configuration error, not a fallback to npx.

## Capabilities

### New Capabilities

- `pinned-mcp-installs` — owns the `package`/`version` schema in `data/mcp.json`, the install lifecycle (install, version-drift detection, binary resolution), the spawn-config rewrite, and validation of partial-pin errors.

### Modified Capabilities

_(none — `lazy-mcp-loading`'s contract is unchanged; the spawn-config shape returned by `loadMcpServer` is implementation detail.)_

## Impact

- **Code:** `src/mcp.ts` (schema additions, branch on `package` presence in `loadMcpServers`/`loadMcpServer`), new `src/mcpInstaller.ts` (install + bin-path resolution), `src/index.ts` (call installer between config load and `testMCP`).
- **Config:** `data/mcp.json` — operators add `package` + `version` per stdio MCP they want pinned. Existing `npx`-shaped entries keep working.
- **Filesystem:** `data/mcp_packages/<name>/` (new) — gitignored, volume-mounted, holds the per-MCP `node_modules` trees and `package-lock.json`.
- **Docs:** `docs/asana-integration.md` and any other per-MCP setup docs updated to show the pinned shape.
