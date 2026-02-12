## Why

Claude has no access to the GitHub API during question-answering sessions. When users ask Clack to review a PR or look at GitHub issues, Claude cannot fetch that data — it can only read local files. The GitHub App credentials (`data/auth/github.json`) already exist and provide scoped, short-lived tokens, but they aren't connected to Claude's MCP tooling. This change auto-configures a GitHub MCP server when credentials are present, giving Claude GitHub API access with permissions derived from the token itself.

## What Changes

- Auto-detect `data/auth/github.json` on startup and inject a GitHub MCP server into Claude's available tools
- Switch from the archived `@modelcontextprotocol/server-github` (npm) to the official `github/github-mcp-server` (Go binary) which supports toolset filtering
- Map GitHub App installation token permissions to `GITHUB_TOOLSETS` for server-side tool filtering (e.g., `pull_requests: read` enables the `pull_requests` toolset)
- Install the `github-mcp-server` binary in the Docker image
- If a user has manually configured a `github` entry in `mcp.json`, skip auto-injection (manual config takes precedence)
- Make `loadMcpServers()` async to support token generation; cache the static `mcp.json` portion but rebuild the GitHub MCP entry per-query with a fresh (cached) token

## Capabilities

### New Capabilities
- `github-mcp-auto-config`: Automatic GitHub MCP server configuration from existing GitHub App credentials, including permission-to-toolset mapping and token injection

### Modified Capabilities
- `claude-code-integration`: MCP servers loading becomes async; GitHub MCP tools become available in Claude sessions
- `docker-deployment`: Dockerfile installs the `github-mcp-server` binary
- `github-app`: Token generation exposes permissions alongside the token string

## Impact

- **Code**: `src/mcp.ts` (async loading, auto-injection logic), `src/github.ts` (expose token permissions), `src/claude.ts` (await async MCP loading)
- **Dependencies**: `github-mcp-server` Go binary added to Docker image (~5.6 MB static binary)
- **Docker**: Dockerfile adds a download step for the binary from GitHub releases
- **Config**: No new config files required; `mcp.example.json` updated to document the auto-config behavior
