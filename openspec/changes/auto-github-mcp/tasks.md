## 1. Expose Token Permissions

- [x] 1.1 Change `getInstallationToken()` in `src/github.ts` to return `{ token, permissions, expiresAt }` instead of just the token string
- [x] 1.2 Update the cached token type to include permissions
- [x] 1.3 Update all call sites of `getInstallationToken()` to use the new return shape (destructure `.token` where only the token string is needed)

## 2. Make MCP Loading Async with GitHub Auto-Injection

- [x] 2.1 Make `loadMcpServers()` in `src/mcp.ts` async; split into cached static config and per-call GitHub MCP injection
- [x] 2.2 Add permission-to-toolset mapping function that converts `Record<string, string>` permissions to a `GITHUB_TOOLSETS` comma-separated string
- [x] 2.3 Add auto-injection logic: check if `github.json` exists, check if `mcp.json` already has a `github` key, check if `github-mcp-server` binary is available, build the MCP server entry with token and toolsets
- [x] 2.4 Add graceful degradation: log warning and skip if binary not found or no mappable permissions
- [x] 2.5 Update `src/claude.ts` to await the now-async `loadMcpServers()`

## 3. Docker Image

- [x] 3.1 Add `GITHUB_MCP_SERVER_VERSION` build arg and download step to `Dockerfile` to install the `github-mcp-server` binary from GitHub releases

## 4. Config and Docs

- [x] 4.1 Update `data/mcp.example.json` to replace the old `@modelcontextprotocol/server-github` entry with a note about auto-configuration
