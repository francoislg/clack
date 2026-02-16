## Context

Clack uses a GitHub App for all git operations (clone, pull, push) and GitHub API calls (PR creation, merge, review). The App credentials live in `data/auth/github.json` and generate short-lived installation tokens cached in memory. MCP servers are loaded from `data/mcp.json` and passed to Claude Agent SDK's `query()`. Currently there is no connection between GitHub App credentials and MCP configuration — users must manually configure a GitHub MCP server if they want Claude to access the GitHub API.

The official `github/github-mcp-server` (Go binary) supports `GITHUB_TOOLSETS` for server-side tool filtering, and GitHub App installation tokens include a `permissions` object that can be introspected at runtime.

## Goals / Non-Goals

**Goals:**
- Auto-configure GitHub MCP server when `data/auth/github.json` exists
- Map token permissions to `GITHUB_TOOLSETS` so Claude only sees tools the token can actually use
- Respect manual `mcp.json` overrides (user-configured `github` entry takes precedence)
- Keep token freshness handled by the existing cache

**Non-Goals:**
- Individual tool-level filtering (toolset-level granularity is sufficient)
- Supporting the old archived `@modelcontextprotocol/server-github` npm package
- Making the permission-to-toolset mapping user-configurable
- Adding GitHub MCP to the changes workflow (this is for question-answering sessions; changes workflow already has direct Octokit access)

## Decisions

### Decision 1: Use `github/github-mcp-server` Go binary

**Choice**: Download the statically-compiled Go binary from GitHub releases into the Docker image.

**Alternatives considered**:
- `@modelcontextprotocol/server-github` (npm, `npx`): Archived, no toolset filtering, no scope awareness
- Docker-in-Docker with `ghcr.io/github/github-mcp-server`: Adds Docker runtime dependency and complexity
- Build from source with `go install`: Requires Go toolchain in the image

**Rationale**: The static binary is ~5.6 MB, zero dependencies, works on Alpine (CGO_ENABLED=0). Simplest to install and operate.

### Decision 2: Map permissions to toolsets at MCP injection time

**Choice**: When building the GitHub MCP server config, read `result.permissions` from the installation token and map permission keys to `GITHUB_TOOLSETS` values.

**Mapping**:
| Token permission      | GITHUB_TOOLSETS value |
|-----------------------|-----------------------|
| `pull_requests`       | `pull_requests`       |
| `issues`              | `issues`              |
| `contents`            | `repos`               |
| `actions`             | `actions`             |
| `security_events`     | `code_security`       |

Any permission key not in this map is ignored. The `GITHUB_TOOLSETS` env var is set to a comma-separated list of matched toolsets.

**Rationale**: This gives server-side filtering without needing to know individual tool names. The MCP server never exposes tools for capabilities the token can't access.

### Decision 3: Rebuild GitHub MCP entry per query, cache everything else

**Choice**: `loadMcpServers()` becomes async. The `mcp.json` contents are cached on first load (no change). The GitHub MCP entry is rebuilt on each call to get a potentially-refreshed token.

**Rationale**: `getInstallationToken()` already caches with a 5-minute expiry buffer, so the per-call cost is one cache check (microseconds). This avoids stale tokens in long-running sessions while keeping `mcp.json` parsing as a one-time cost.

### Decision 4: Manual `mcp.json` github entry takes precedence

**Choice**: If `mcp.json` already contains a key named `github`, skip auto-injection entirely.

**Rationale**: Users may want to use a PAT-based setup, point to a GitHub Enterprise instance, or use custom toolset filtering. The auto-config is a convenience default, not a mandate.

### Decision 5: Expose permissions from getInstallationToken

**Choice**: Change `getInstallationToken()` to return `{ token, permissions, expiresAt }` instead of just the token string. Update call sites accordingly.

**Alternative**: Create a separate `getTokenPermissions()` function.

**Rationale**: The permissions are already on the auth result object — it's cleaner to return them together than to cache them separately.

## Risks / Trade-offs

- **Mapping drift**: If `github/github-mcp-server` adds new toolsets, our mapping won't include them until updated. → Mitigation: The mapping only gates what's *enabled*, not what's blocked. New toolsets are simply not auto-enabled, which is the safe default.

- **Binary version pinning**: The Dockerfile pins a specific release version. → Mitigation: Use a build arg (`GITHUB_MCP_SERVER_VERSION`) so it's easy to update.

- **Local development**: The Go binary needs to be installed locally for non-Docker development. → Mitigation: If the binary isn't found, log a warning and skip GitHub MCP injection (graceful degradation, don't block startup).

- **Token in env var**: The installation token is passed via environment variable to the MCP subprocess. → Mitigation: Installation tokens are short-lived (~1 hour) and the MCP server process is ephemeral (dies after each query).
