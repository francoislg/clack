# Monday.com Integration

Clack can integrate with Monday.com via an MCP server, giving Claude access to Monday.com tools (boards, items, updates, etc.) during query sessions.

## Authentication

Monday.com does not support app-level bot identities — all API tokens are user-centric. Even OAuth tokens act on behalf of the authorizing user, not as an independent app. There is no equivalent to Linear's `actor=app` or Slack's bot tokens.

**Recommended approach:** Create a dedicated Monday.com user account for the bot (e.g. `clack@yourdomain.com`) with a "Clack" display name and avatar, then create an OAuth app for scoped, resilient tokens.

### Step 1: Create a dedicated Monday.com user

1. Create a Monday.com user named **"Clack"** (requires a seat on your plan)
2. Set the display name and avatar to match your bot's identity

All API actions will appear as this user.

### Step 2: Create an OAuth app

Using an OAuth app token is preferred over a personal API token:

| | Personal API Token | OAuth App Token |
|---|---|---|
| **Scoped** | No — full access | Yes — only requested permissions |
| **Survives token regen** | No — breaks if user regenerates | Yes — independent |
| **Expires** | No | No (until user uninstalls app) |

1. Go to **your Monday.com Developer Center** (e.g. `https://<your-workspace>.monday.com/apps/manage`)
2. Click **Create App** — name it "Clack", set an icon
3. Go to the app's **OAuth** tab
4. Add the following **scopes** (adjust to your needs):
   - `boards:read`, `boards:write`
   - `updates:read`, `updates:write`
   - `users:read`
   - `docs:read`, `docs:write` (if needed)
   - `teams:read` (if needed)
5. Set the **Redirect URI** to `http://localhost:3000/callback`
6. Note the **Client ID** and **Client Secret**

### Step 3: Obtain the OAuth token

The OAuth flow is a one-time operation. Run the included helper script to start a local server, complete the browser auth, and receive the token:

```bash
node scripts/monday-oauth.mjs <client_id> <client_secret>
```

This will:
1. Start a local HTTP server on port 3000
2. Open your browser to Monday.com's authorization page
3. After you authorize (logged in as the "Clack" user), capture the callback
4. Exchange the authorization code for an access token
5. Print the token and exit

> **Note:** The authorization code is valid for 10 minutes. Monday.com OAuth tokens do not expire and do not require refresh tokens.

If you prefer to do it manually, set the redirect URI to `http://localhost` instead. After authorizing in the browser, the page will fail to load but the authorization code will be in the URL bar (`?code=XXX`). Exchange it with:

```bash
curl -X POST https://auth.monday.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&code=THE_CODE&redirect_uri=http://localhost"
```

## Configuration

### 1. Set the API token

Add to `data/auth/.env`:

```env
MONDAY_TOKEN=your_oauth_token
```

### 2. Create the MCP server config

Create (or update) `data/mcp.json`:

```json
{
  "mcpServers": {
    "monday": {
      "command": "npx",
      "args": ["@mondaydotcomorg/monday-api-mcp@latest"],
      "env": {
        "MONDAY_TOKEN": "${MONDAY_TOKEN}"
      }
    }
  }
}
```

The `${MONDAY_TOKEN}` placeholder is resolved from `process.env` at runtime by Clack's MCP config loader.

### 3. Restart Clack

The Monday.com MCP server will be loaded on startup. Verify by checking the logs for:

```
Loaded MCP config: monday
```

Claude will then have access to Monday.com tools during query sessions.

## References

- [Official Monday MCP repo](https://github.com/mondaycom/mcp)
- [Monday.com OAuth docs](https://developer.monday.com/apps/docs/oauth)
- [Monday.com API authentication docs](https://developer.monday.com/api-reference/docs/authentication)
- [Monday MCP getting started guide](https://support.monday.com/hc/en-us/articles/28588158981266-Get-started-with-monday-MCP)
