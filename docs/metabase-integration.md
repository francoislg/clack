# Metabase Integration

Clack can integrate with Metabase via a community MCP server, giving Claude read-only access to Metabase dashboards, saved questions, and query results during query sessions.

There is no official Metabase MCP server — all options are community-built. This doc covers the recommended options and configuration.

## MCP Server Options

### Option A: `@jerichosequitin/metabase-mcp` (Recommended)

Best for read-only analytics. Read-only mode is **enabled by default**, blocking INSERT/UPDATE/DELETE/DROP. Token-optimized responses (claims ~90% reduction). Active releases (v1.1.5, Feb 2026).

| | |
|---|---|
| **GitHub** | [jerichosequitin/metabase-mcp](https://github.com/jerichosequitin/metabase-mcp) |
| **npm** | `@jerichosequitin/metabase-mcp` |
| **Stars** | ~56 |
| **Tools** | 6 — `list`, `retrieve`, `search`, `execute`, `export`, `clear_cache` |
| **Read-only** | Default ON (`METABASE_READ_ONLY_MODE=true`) |
| **Docker** | `ghcr.io/jerichosequitin/metabase-mcp:latest` |

### Option B: `@cognitionai/metabase-mcp-server` (More capabilities)

Best if you need granular control or plan to expand beyond read-only later. Supports `--read`, `--write`, `--essential`, and `--all` flags to control which tools are loaded. Backed by Cognition (Devin). Requires Node.js 20.19.0+.

| | |
|---|---|
| **GitHub** | [CognitionAI/metabase-mcp-server](https://github.com/CognitionAI/metabase-mcp-server) |
| **npm** | `@cognitionai/metabase-mcp-server` |
| **Stars** | ~44 |
| **Tools** | 81+ — dashboards, cards, databases, tables, public sharing, embedding |
| **Read-only** | Via `--read` flag |
| **Docker** | `ghcr.io/CognitionAI/metabase-mcp-server` |

### Other options

| Server | Stars | Tools | Read-Only | Notes |
|--------|-------|-------|-----------|-------|
| [imlewc/metabase-server](https://github.com/imlewc/metabase-server) | ~132 | 6 | Implicit (no write tools) | Most popular but minimal |
| [easecloudio/mcp-metabase-server](https://github.com/easecloudio/mcp-metabase-server) | ~56 | 70+ | No toggle | Full CRUD, Docker MCP Catalog |
| [enessari/metabase-ai-assistant](https://github.com/enessari/metabase-ai-assistant) | ~29 | 134 | Default ON | AI SQL generation, newest/least proven |
| [hluaguo/metabase-mcp](https://github.com/hluaguo/metabase-mcp) | ~53 | 9 | No toggle | Python (`uvx metabase-mcp`) |

## Authentication

Metabase does not support app-level bot identities — API keys and tokens are tied to users or groups.

**Recommended approach:** Create a dedicated Metabase user account for the bot, then generate an API key scoped to a read-only group.

### Step 1: Create a dedicated Metabase user

1. Go to **Metabase Admin > People**
2. Click **Create account** (or **Invite someone** depending on version)
3. Use a shared/service email (e.g. `clack@yourdomain.com`)
4. Set the name to **"Clack"** (or your bot's name)

### Step 2: Set up a read-only group

1. Go to **Metabase Admin > People > Groups**
2. Create a new group (e.g. "Clack Bot") or use an existing read-only group
3. Add the Clack user to this group
4. Go to **Metabase Admin > Permissions** and configure:
   - **Data access:** Set databases to **Granular** or **No self-service** depending on whether you want Claude to run arbitrary SQL or only execute saved questions
   - **Collection access:** Grant **View** access to collections Clack should see
   - **Native query editing:** Set to **No** if you want to restrict to saved questions only

### Step 3: Generate an API key

Requires Metabase 49+. For older versions, use the personal access token approach below.

1. Go to **Metabase Admin > Settings > Authentication > API Keys**
2. Click **Create API key**
3. Name it "Clack" and associate it with the bot user's group
4. Copy the key — it won't be shown again

**Alternative (Metabase < 49):** Log in as the Clack user, go to **Account settings > API keys** (or **Personal access tokens** depending on version), and create a token. Actions will appear as the Clack user.

## Configuration

### 1. Set the API key

Add to `data/auth/.env`:

```env
METABASE_URL=https://metabase.yourdomain.com
METABASE_API_KEY=mb_xxxxx
```

### 2. Create the MCP server config

**Option A** — `@jerichosequitin/metabase-mcp` (recommended):

Add to `data/mcp.json`:

```json
{
  "mcpServers": {
    "metabase": {
      "command": "npx",
      "args": ["-y", "@jerichosequitin/metabase-mcp"],
      "env": {
        "METABASE_URL": "${METABASE_URL}",
        "METABASE_API_KEY": "${METABASE_API_KEY}",
        "METABASE_READ_ONLY_MODE": "true"
      }
    }
  }
}
```

Read-only mode is on by default but setting it explicitly is good practice.

**Option B** — `@cognitionai/metabase-mcp-server`:

```json
{
  "mcpServers": {
    "metabase": {
      "command": "npx",
      "args": ["-y", "@cognitionai/metabase-mcp-server", "--read"],
      "env": {
        "METABASE_URL": "${METABASE_URL}",
        "METABASE_API_KEY": "${METABASE_API_KEY}"
      }
    }
  }
}
```

The `--read` flag loads only read-only tools.

### 3. Restart Clack

The Metabase MCP server will be loaded on startup. Verify by checking the logs for:

```
Loaded MCP config: metabase
```

If `watchMcpConfig` is enabled in your config, changes to `data/mcp.json` and `data/auth/.env` are picked up automatically on the next query — no restart needed.

## Security Considerations

**Defense in depth** — read-only access is enforced at multiple layers:

1. **Metabase group permissions** — the bot's group has view-only access to data and collections
2. **MCP server** — read-only mode (Option A) or `--read` flag (Option B) blocks mutation tools
3. **Database user** — if Metabase connects to your DB with a read-only user, that's a third layer

Even if one layer is misconfigured, the others prevent writes.

**What Claude can access:** Claude sees everything the Clack Metabase user's group has access to. Scope the group permissions carefully — exclude sensitive collections (HR data, salary dashboards, etc.) unless you want Claude to have access.

## Limitations

- **Query mode only** — external MCP servers (including Metabase) are loaded in query sessions but not in worker mode (Changes Workflow). This is fine since Metabase access is a read operation.
- **No per-user scoping** — all Slack users who interact with Clack share the same Metabase identity. There's no way to pass through the Slack user's Metabase permissions.
- **API key attribution** — reports or queries created through the API are attributed to the bot user or API key group, not individual Slack users.

## References

- [Metabase API documentation](https://www.metabase.com/docs/latest/api-documentation)
- [Metabase API keys](https://www.metabase.com/docs/latest/people-and-groups/api-keys)
- [Metabase permissions](https://www.metabase.com/docs/latest/permissions/introduction)
- [jerichosequitin/metabase-mcp](https://github.com/jerichosequitin/metabase-mcp)
- [CognitionAI/metabase-mcp-server](https://github.com/CognitionAI/metabase-mcp-server)
