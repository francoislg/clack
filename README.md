# Clack

A self-hosted Slack bot that answers codebase questions using Claude Code. React to any message with an emoji, DM the bot, or @mention it — Clack reads your repositories and responds with plain-language answers. Optionally enable the **Changes Workflow** to propose code changes, create PRs, and merge — all from Slack.

**Clack** = **Cl**aude + Sl**ack**

## How It Works

### Reactions (default)

1. **React** — Add the configured emoji (e.g., 🤖) to any Slack message
2. **Review** — Clack sends you a private answer (ephemeral or via DM)
3. **Decide** — Accept to share publicly, refine for a better answer, or reject

### Direct Messages & Mentions

Send a question directly to Clack or @mention it in a channel. Responses are posted visibly in the thread — no accept/reject step needed. Reply in the thread to continue the conversation.

## Features

- **Multi-repo support** — Configure multiple repositories with per-repo access control
- **Three trigger modes** — Reactions, DMs, and @mentions (each independently configurable)
- **Session memory** — Refinements and follow-ups build on previous context
- **Role-based access** — Owner, admin, dev, and member tiers with granular permissions
- **Changes Workflow** — Request code changes, create branches, push commits, open and merge PRs from Slack
- **GitHub integration** — Full read/write GitHub access via GitHub App + auto-configured MCP server
- **Customizable instructions** — Two-tier instruction system with shipped defaults and org-specific overrides
- **Home Tab** — Manage roles, view repositories, edit instructions, and monitor active workers
- **Docker support** — Multi-stage build with interactive setup script

## Built-in Plugins

Clack ships with a small set of built-in plugins. Enable each via `config.plugins[]`.

### casual-talk

Drops casual chatter into configured channels on a probabilistic schedule. On every cron tick within work hours, the plugin rolls a virtual die — only on `1` does Claude actually post. The bot evaluates all configured candidate channels at fire time and posts to whichever feels most natural to join (or skips cleanly if none fit).

**Config** (`data/plugins/casual-talk/config.json`):

```json
{
  "enabled": true,
  "channels": [
    "C0123456789",
    { "id": "C9876543210", "promptSuggestion": "memes only — keep it visual" }
  ],
  "workHours": { "start": 9, "end": 17, "tz": "America/Montreal", "days": [1, 2, 3, 4, 5] },
  "expectedRate": "daily",
  "smallTalkTopics": ["food", "weekend plans", "pop culture"]
}
```

**Important:** `expectedRate` is **total across all configured channels**, not per-channel. With `expectedRate: "daily"` and 5 channels, you'd see ~1 post/day total — about 1 post per channel every 5 days. Use `daily`/`weekly` rates carefully when you have many channels.

Manage the config from Slack by attaching the `casual-talk:management` integration (admin-only) — tools include `add_channel`, `remove_channel`, `set_expected_rate`, `set_work_hours`, `enable`, `disable`, and more.

## Setup

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed
- A GitHub App installed on your org (see below)
- Slack app with Bot Token and App Token

### GitHub App Setup

Clack authenticates with GitHub using a GitHub App. Each self-hosted deployment needs its own app.

1. Go to your **Organization Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. Fill in the app name (e.g., "Clack")
3. Set **Repository permissions**:
   - **Contents**: Read & write (clone repos, push branches)
   - **Pull requests**: Read & write (create/merge/close PRs)
   - **Metadata**: Read-only
   - **Checks**: Read-only (lets the worker read CI check-runs via `await_ci`; without it every poll 403s and `await_ci` fails with "could not read CI status")
   - **Issues**: Read & write _(optional — enables issue tools in the GitHub MCP server)_
   - **Commit statuses**: Read-only _(optional — only if your CI reports through the legacy Statuses API rather than Check Runs)_
4. Click **Create GitHub App**
5. On the app's General page, note the **App ID**
6. Scroll to **Private keys** and click **Generate a private key** — save the `.pem` file
7. Click **Install App** in the sidebar, install it on your org, and select the repositories Clack should access
8. Note the **Installation ID** from the URL (`https://github.com/settings/installations/{ID}`)

Now configure the credentials:

```bash
cp data/auth/github.example.json data/auth/github.json
```

Edit `data/auth/github.json`:

```json
{
  "appId": "123456",
  "installationId": "78901234",
  "privateKeyPath": "data/auth/github-app.pem"
}
```

Copy your `.pem` file:

```bash
cp ~/Downloads/your-app-name.private-key.pem data/auth/github-app.pem
```

### Claude Authentication

Clack supports two authentication methods:

#### Option 1: OAuth Token (Recommended for Claude Max/Pro subscribers)

Use your existing Claude subscription with no additional API charges:

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Generate a long-lived token: `claude setup-token`
3. Set the environment variable:
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   ```

For Docker, add to `data/auth/.env`:

```
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-your-token-here
```

#### Option 2: API Key (Pay-as-you-go)

Use the Anthropic API with pay-per-use billing:

1. Get your API key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Set the environment variable:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-api...
   ```

For Docker, add to `data/auth/.env`:

```
ANTHROPIC_API_KEY=sk-ant-api-your-key-here
```

**Note:** Do not set both variables. If `ANTHROPIC_API_KEY` is set, it takes priority and you'll be charged API rates.

### Configuration

1. Copy the example config:

   ```bash
   cp data/config.example.json data/config.json
   ```

2. Edit `data/config.json` — see `data/config.example.json` for the full schema. The key sections:
   - **`reactions`** — Trigger emoji, thinking indicator, optional work-mode emoji
   - **`directMessages`** / **`mentions`** — Enable/disable DM and @mention triggers. DMs support three `dmType` modes: `"assistant"` (default, legacy Slack Assistant API / `assistant_view` — being deprecated by Slack), `"agent"` (the current **Agent messaging experience** / `agent_view` — requires Bolt 5, uses `app_home_opened` + `message.im`; the `agent_view` workspace switch is **irreversible**), or `"classic"` (low-level `message.im` event, no `assistant:write` scope, view-agnostic). Switching `dmType` requires regenerating + re-uploading the manifest and a restart; a reinstall is only needed when the switch adds a new scope.
   - **`repositories`** — Repos to index, with access control (`read`/`write` role thresholds) and merge strategy
   - **`changesWorkflow`** — Enable the Changes Workflow with timeout, concurrency, and monitoring settings
   - **`claudeCode.model`** — Claude model to use (default: `sonnet`)
   - **`allowPublicSearch`** (optional, default `false`) — Enable the `search_messages` tool: workspace-wide **literal keyword** search over public-channel message text (via Slack's `assistant.search.context`). ⚠️ Enabling requires **re-uploading the manifest AND reinstalling the app to the workspace** — a bot token does not retroactively gain the added `search:read.public` scope. Search only works from **direct-message and @mention** triggers (Slack mints the required `action_token` only on those events; reaction- and schedule-triggered sessions cannot search). It searches message **text** only — an emoji used as a _reaction_ is not message content and is not findable this way; use the emoji-lore `lore_hint` on `fetch_channel_messages` for reaction usage.

3. Generate the Slack app manifest:

   ```bash
   npm install
   npm run manifest
   ```

4. Run the bot:
   ```bash
   npm start
   ```

### Slack App Setup

1. Create a new Slack app at https://api.slack.com/apps using the generated `slack-app-manifest.json`
2. Enable **Socket Mode** in the app settings
3. Generate an **App-Level Token** with `connections:write` scope
4. Install the app to your workspace
5. Save credentials to `data/auth/slack.json`:
   ```json
   {
     "botToken": "xoxb-...",
     "appToken": "xapp-...",
     "signingSecret": "..."
   }
   ```

The manifest generator automatically configures the correct scopes and event subscriptions based on your `config.json` settings (e.g., DM scopes are only added if DMs are enabled).

### Docker Deployment

```bash
# Interactive setup — prompts for credentials and generates config
npm run docker-setup

# Or manually
docker build -t clack .
docker run -d --name clack --env-file data/auth/.env -v ./data:/app/data clack
```

## Changes Workflow

When enabled, dev+ users can request code changes directly from Slack. Clack creates a git worktree, implements the changes, pushes a branch, and opens a PR.

**Flow:** Request change → Clack creates branch (`clack/{type}/{name}`) → implements in worktree → pushes & opens PR → follow up with review/update/merge/close in the thread.

A background monitor detects externally merged or closed PRs and cleans up worktrees automatically.

## Role System

| Role       | Capabilities                                      |
| ---------- | ------------------------------------------------- |
| **Owner**  | Everything + transfer ownership                   |
| **Admin**  | Manage roles, edit instructions and configuration |
| **Dev**    | Propose code changes (per-repo write access)      |
| **Member** | Ask questions (default role)                      |

Roles are managed from the Home Tab in Slack. Persisted in `data/state/roles.json`.

## Instruction System

Clack uses a two-tier instruction system to guide Claude's behavior:

- **Defaults** (`data/default_configuration/`) — Shipped with the project, checked into git
- **Overrides** (`data/configuration/`) — Org-specific customizations, gitignored, take precedence

Instruction files: `instructions.md` (base), `dev_instructions.md`, `admin_instructions.md`, `user_instructions.md` (role overlays), plus per-repo `{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`, and `{repo}/verification_checks.json` (opt-in pre-push gate — see `data/default_configuration/dev/changes.md` for the schema).

Template variables like `{BOT_NAME}` are interpolated at runtime. Admins can edit instructions from the Home Tab.

## Development

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run manifest  # Generate Slack app manifest
npm start         # Run the bot
npm run dev       # Watch mode (rebuild on changes)
npm run test      # Run tests
```

## License

ISC
