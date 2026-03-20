# Linear Integration

Clack can integrate with Linear via the [Linear MCP server](https://mcp.linear.app), giving Claude access to Linear tools (create/update issues, search, comment, etc.) during query sessions.

## Authentication Options

### Option A: Personal API Key (Recommended for simplicity)

A personal API key never expires and requires no token refresh logic.

1. Create a dedicated Linear account for the bot (e.g. `clack@yourdomain.com`)
2. Log in as that account
3. Go to **Settings > My Account > API > Personal API keys**
4. Create a new key and copy it

Actions in Linear will appear as that user.

### Option B: OAuth2 Application (Bot identity)

An OAuth2 app gives Clack a distinct bot identity in Linear but requires periodic token refresh (every 30 days).

1. Go to [linear.app/developers](https://linear.app/developers) (must be done in the UI — no API for this)
2. Create a new **OAuth2 Application**
   - Name: `Clack` (or your preferred bot name)
   - Set an icon/avatar
3. In the app settings, enable **Client credentials tokens**
4. Request the following OAuth scopes:
   - `read` — read workspace data (issues, projects, teams, etc.)
   - `write` — create and update issues, comments, etc.
   - Do **not** request `admin` — it is not available with `actor=app`
5. Install the app into your workspace using the OAuth authorization URL with `actor=app`:
   ```
   https://linear.app/oauth/authorize?client_id=YOUR_CLIENT_ID&scope=read,write&actor=app&redirect_uri=YOUR_REDIRECT_URI&response_type=code
   ```
6. Exchange the authorization code for a client credentials token:
   ```bash
   curl -X POST https://api.linear.app/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
   ```

**Important:** The client credentials token is valid for **30 days**. Only one active token per app — requesting a new one invalidates the previous one. You will need to build token rotation logic if you choose this option.

## Configuration

### 1. Set the API token

Add to `data/auth/.env`:

```env
LINEAR_API_TOKEN=lin_api_xxxxx
```

### 2. Create the MCP server config

Create (or update) `data/mcp.json`:

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_TOKEN}"
      }
    }
  }
}
```

The `${LINEAR_API_TOKEN}` placeholder is resolved from `process.env` at runtime by Clack's MCP config loader.

### 3. Restart Clack

The Linear MCP server will be loaded on startup. Verify by checking the logs for:

```
Loaded MCP config: linear
```

Claude will then have access to Linear tools during query sessions.
