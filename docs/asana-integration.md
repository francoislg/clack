# Asana Integration

Clack can integrate with Asana via an MCP server, giving Claude access to Asana tools (workspaces, projects, tasks, stories, etc.) during query sessions.

## Authentication

Asana has no true app-level bot identity on non-Enterprise plans. [Service Accounts](https://help.asana.com/s/article/service-accounts) — the only real bot identity — are available on **Enterprise** and **Enterprise+** only.

**Recommended approach for Basic / Starter / Advanced plans:** Create a dedicated Asana user for the bot (e.g. `clack@yourdomain.com`) with a "Clack" display name and avatar, then generate a [Personal Access Token](https://developers.asana.com/docs/personal-access-token) (PAT) from that account. PATs do not expire and act with the user's permissions, so scope the user's workspace/project access to what the bot needs.

### Step 1: Create a dedicated Asana user

1. Invite `clack@<yourdomain>` (or equivalent) to your Asana workspace
2. Set the display name to **"Clack"** and upload an avatar matching your bot's identity
3. Grant access to only the workspaces, teams, and projects the bot should touch — the PAT inherits this access

All actions created via the PAT will be attributed to this user in Asana's activity feed.

### Step 2: Generate the Personal Access Token

Log in **as the Clack user** (not your own account — the token acts as whichever user generates it):

1. Go to <https://app.asana.com/0/my-apps>
2. Find the **Personal access tokens** section (separate from "New App", which is for OAuth apps — skip that)
3. Click **"+ Create new token"**
4. Name it `clack-mcp`
5. Accept the Asana API Terms
6. Click **Create token**
7. **Copy the token immediately** — Asana only shows it once. If you miss it, delete it and regenerate.

The token does not expire. It can be revoked at any time from the same page.

> **Alternative path if the button isn't visible:** profile photo (top right) → **My Settings** → **Apps** tab → **Manage Developer Apps** → **Create new token**.

## Configuration

### 1. Set the access token

Add to `data/auth/.env`:

```env
ASANA_ACCESS_TOKEN=your_personal_access_token
```

### 2. MCP server config

The `asana` entry is already included in `data/mcp.json`:

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["-y", "@roychri/mcp-server-asana"],
      "env": {
        "ASANA_ACCESS_TOKEN": "${ASANA_ACCESS_TOKEN}"
      }
    }
  }
}
```

The `${ASANA_ACCESS_TOKEN}` placeholder is resolved from `process.env` at runtime by Clack's MCP config loader.

### 3. Restart Clack

The Asana MCP server will be loaded on startup. Verify by checking the logs for:

```
Loaded MCP config: asana
```

Claude will then have access to Asana tools during query sessions.

## Notes

- **Enterprise plan?** If you have Asana Enterprise or Enterprise+, prefer a [Service Account](https://help.asana.com/s/article/service-accounts) over a PAT — it's a true bot identity with no human user dependency. The MCP config stays the same; just set `ASANA_ACCESS_TOKEN` to the service account token.
- **Rotation:** Revoke from `app.asana.com/0/my-apps`, generate a new PAT, update `data/auth/.env`, restart.
- **User deactivation:** If the Clack user is deactivated, the PAT stops working. Keep the user active.
- **Not the official Asana MCP:** Asana's official V2 MCP server (`https://mcp.asana.com/v2/mcp`) is OAuth-only and not bot-friendly. We use the community [@roychri/mcp-server-asana](https://github.com/roychri/mcp-server-asana), which accepts a static access token.

## References

- [Community MCP server (@roychri/mcp-server-asana)](https://github.com/roychri/mcp-server-asana)
- [Asana Personal Access Token docs](https://developers.asana.com/docs/personal-access-token)
- [Asana Authentication overview](https://developers.asana.com/docs/authentication)
- [Asana Service Accounts (Enterprise only)](https://help.asana.com/s/article/service-accounts)
