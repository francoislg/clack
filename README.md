# Clack

A Slack bot that answers codebase questions using Claude Code. React to any message with a configured emoji, and Clack provides non-technical answers visible only to you. Accept to share with the team, refine for better answers, or reject to dismiss.

**Clack** = **Cl**aude + Sl**ack**

## How It Works

1. **React** — Add the configured emoji (e.g., 🤖) to any Slack message
2. **Review** — Clack sends you an ephemeral answer (only you can see it)
3. **Decide** — Click one of:
   - **✅ Accept** — Share the answer with everyone in the thread
   - **✏️ Edit & Accept** — Edit the answer before sharing
   - **🔄 Refine** — Add instructions and get a better answer
   - **🔃 Update** — Re-read the thread and regenerate
   - **❌ Reject** — Dismiss the answer

## Features

- **Non-technical answers** — Explains code in plain language for non-developers
- **Multi-repo support** — Configure multiple repositories; Clack picks the relevant one(s)
- **Thread-aware** — Understands conversation context from Slack threads
- **Session memory** — Refinements build on previous answers (15-min timeout)
- **Ephemeral first** — Review before sharing with your team
- **Thinking feedback** — Show an emoji reaction or message while processing

## Setup

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed
- SSH key with access to your repositories
- Slack app with Bot Token and App Token

### Claude Authentication

Clack supports two authentication methods:

#### Option 1: OAuth Token (Recommended for Claude Max/Pro subscribers)

Use your existing Claude Max or Pro subscription with no additional API charges:

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

2. Edit `data/config.json`:
   ```json
   {
     "slack": {
       "botToken": "xoxb-...",
       "appToken": "xapp-...",
       "signingSecret": "..."
     },
     "reactions": {
       "trigger": "robot_face",
       "thinking": {
         "type": "emoji",
         "emoji": "thinking_face"
       }
     },
     "repositories": [
       {
         "name": "my-app",
         "url": "git@github.com:org/my-app.git",
         "description": "Main application codebase",
         "branch": "main"
       }
     ],
     "claudeCode": {
       "model": "sonnet"
     }
   }
   ```

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
4. Add the following **Bot Token Scopes** under OAuth & Permissions:
   - `reactions:read` — Detect trigger reactions
   - `reactions:write` — Add thinking emoji feedback
   - `channels:history` — Read messages in public channels
   - `groups:history` — Read messages in private channels
   - `chat:write` — Post responses
   - `im:history` — Read direct messages (optional)
5. Subscribe to these **Events** under Event Subscriptions:
   - `reaction_added`
6. Install the app to your workspace
7. Copy the tokens to your `data/config.json`:
   - Bot Token (`xoxb-...`) → `slack.botToken`
   - App Token (`xapp-...`) → `slack.appToken`
   - Signing Secret → `slack.signingSecret`

### SSH Key Setup

For private repositories, configure SSH access:

1. Generate a deploy key (recommended) or use an existing SSH key:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/clack_deploy -N ""
   ```

2. Add the public key to your repository as a deploy key (read-only is sufficient)

3. Set the path in your config:
   ```json
   {
     "git": {
       "sshKeyPath": "~/.ssh/clack_deploy"
     }
   }
   ```

## Configuration Reference

| Key | Description | Default |
|-----|-------------|---------|
| `slack.botToken` | Slack bot token (xoxb-...) | Required |
| `slack.appToken` | Slack app token (xapp-...) | Required |
| `slack.signingSecret` | Slack signing secret | Required |
| `slackApp.name` | App display name in Slack | `Clack` |
| `slackApp.description` | App description in Slack | `Ask questions about your codebase using reactions` |
| `slackApp.backgroundColor` | Hovercard background color (hex) | `#4A154B` |
| `reactions.trigger` | Emoji name that triggers the bot | `robot_face` |
| `reactions.thinking.type` | Feedback type: `message` or `emoji` | `message` |
| `reactions.thinking.emoji` | Emoji to show while thinking (if type is `emoji`) | — |
| `repositories[].name` | Local folder name for the repo | Required |
| `repositories[].url` | Git clone URL (SSH) | Required |
| `repositories[].description` | Description for Claude context | Required |
| `repositories[].branch` | Branch to clone | `main` |
| `git.sshKeyPath` | Path to SSH key | System default |
| `git.pullIntervalMinutes` | How often to pull updates | `60` |
| `git.shallowClone` | Use shallow clone | `true` |
| `git.cloneDepth` | Depth for shallow clone | `1` |
| `sessions.timeoutMinutes` | Session inactivity timeout | `15` |
| `sessions.cleanupIntervalMinutes` | How often to clean expired sessions | `5` |
| `claudeCode.model` | Claude model to use | `sonnet` |

## Development

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run manifest  # Generate Slack app manifest
npm start         # Run the bot
npm run dev       # Watch mode (rebuild on changes)
```

## Architecture

```
src/
├── index.ts        # Entry point, startup sequence
├── config.ts       # Configuration loading and validation
├── repositories.ts # Git clone/pull operations
├── sessions.ts     # Session lifecycle management
├── claude.ts       # Claude Agent SDK integration
└── slack/
    ├── app.ts         # Slack Bolt app setup
    ├── blocks.ts      # Slack block builders
    ├── state.ts       # Session info state
    ├── messagesApi.ts # Slack messages API helpers
    └── handlers/      # Action and event handlers

data/
├── config.json         # Your configuration (gitignored)
├── config.example.json # Example configuration
├── repositories/       # Cloned repos (gitignored)
└── sessions/           # Session state (gitignored)
```

## License

ISC
