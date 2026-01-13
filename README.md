# Clack

A Slack bot that answers codebase questions using Claude Code. React to any message with a configured emoji, and Clack provides non-technical answers visible only to you. Accept to share with the team, refine for better answers, or reject to dismiss.

**Clack** = **Cl**aude + Sl**ack**

## How It Works

1. **React** — Add the configured emoji (e.g., 🤖) to any Slack message
2. **Review** — Clack sends you an ephemeral answer (only you can see it)
3. **Decide** — Click one of:
   - **Accept** — Share the answer with everyone in the thread
   - **Reject** — Dismiss the answer
   - **Refine** — Add instructions and get a better answer
   - **Update** — Re-read the thread and regenerate

## Features

- **Non-technical answers** — Explains code in plain language for non-developers
- **Multi-repo support** — Configure multiple repositories; Clack picks the relevant one(s)
- **Thread-aware** — Understands conversation context from Slack threads
- **Session memory** — Refinements build on previous answers (15-min timeout)
- **Ephemeral first** — Review before sharing with your team

## Setup

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- SSH key with access to your repositories
- Slack app with Bot Token and App Token

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
     "triggerReaction": "robot_face",
     "repositories": [
       {
         "name": "my-app",
         "url": "git@github.com:org/my-app.git",
         "description": "Main application codebase",
         "branch": "main"
       }
     ]
   }
   ```

3. Install and run:
   ```bash
   npm install
   npm start
   ```

### Slack App Setup

1. Create a new Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** in the app settings
3. Generate an **App-Level Token** with `connections:write` scope
4. Add the following **Bot Token Scopes** under OAuth & Permissions:
   - `reactions:read` — Detect trigger reactions
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
| `triggerReaction` | Emoji name that triggers the bot | `robot_face` |
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
| `claudeCode.path` | Path to Claude CLI | `claude` |
| `claudeCode.model` | Claude model to use | `sonnet` |

## Development

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
npm start      # Run the bot
npm run dev    # Watch mode (rebuild on changes)
```

## Architecture

```
src/
├── index.ts        # Entry point, startup sequence
├── config.ts       # Configuration loading and validation
├── repositories.ts # Git clone/pull operations
├── sessions.ts     # Session lifecycle management
├── claude.ts       # Claude Code CLI integration
└── slack.ts        # Slack Bolt app and handlers

data/
├── config.json         # Your configuration (gitignored)
├── config.example.json # Example configuration
├── repositories/       # Cloned repos (gitignored)
└── sessions/           # Session state (gitignored)
```

## License

ISC
