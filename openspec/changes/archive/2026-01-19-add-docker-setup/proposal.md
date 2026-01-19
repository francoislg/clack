# Change: Add Docker Setup Script and Dockerfile

## Why
Deploying Clack currently requires manual setup of multiple credentials (SSH keys, Anthropic API key, Slack tokens) and understanding how they connect. A setup script that validates and configures these credentials in a Docker-friendly way would simplify deployment and reduce errors.

## What Changes
- Add `scripts/docker-setup.sh` interactive setup script that:
  - Creates `data/auth/` directory structure (gitignored)
  - Generates or imports SSH keys for Git repository access
  - Prompts for and validates `ANTHROPIC_API_KEY`
  - Prompts for and validates Slack credentials (bot token, app token, signing secret)
  - Validates that required credentials are present and correctly formatted
  - Outputs instructions for GitHub SSH key approval
- Add `Dockerfile` that bundles the application with credentials from `data/auth/`
- Add `.dockerignore` for build optimization
- Update `.gitignore` to exclude `data/auth/`
- **Move Slack credentials from `data/config.json` to `data/auth/slack.json`**
- Update config loading to read Slack tokens from separate auth file

## Impact
- Affected specs: None (new capability)
- Affected code:
  - `scripts/docker-setup.sh` (new)
  - `scripts/gce-deploy.sh` (new)
  - `Dockerfile` (new)
  - `.dockerignore` (new)
  - `.gitignore` (modified)
  - `data/auth/.gitkeep` (new)
  - `src/config.ts` (modified - load Slack auth from separate file)
  - `data/config.example.json` (modified - remove Slack tokens)
  - `package.json` (modified - added docker-setup and deploy:gce scripts)

## Environment Variables Required
Based on codebase analysis, the following are needed at runtime:
1. **`ANTHROPIC_API_KEY`** - Required by `@anthropic-ai/claude-agent-sdk` for Claude API access
2. **`HOME`** - Used in `src/repositories.ts:15` to expand `~` in SSH key path (set automatically by Node/Docker)

Note: Slack credentials will be read from `data/auth/slack.json`, not environment variables or `data/config.json`.

## Auth Directory Structure
```
data/
├── auth/                    # NEW - gitignored, Docker-mounted (secrets only)
│   ├── ssh/
│   │   ├── id_rsa           # SSH private key for Git
│   │   └── id_rsa.pub       # SSH public key (for GitHub)
│   ├── slack.json           # Slack credentials (botToken, appToken, signingSecret)
│   └── .env                 # ANTHROPIC_API_KEY storage
├── config.json              # Non-sensitive config (reactions, repos, paths, timeouts)
├── repositories/            # Existing - cloned repos
└── sessions/                # Existing - runtime sessions
```

Note: `git.sshKeyPath` remains in `config.json` (it's a path, not a secret) but defaults to `data/auth/ssh/id_rsa`.

## Credential Separation
**Before (config.json):**
```json
{
  "slack": {
    "botToken": "xoxb-...",      // SECRET
    "appToken": "xapp-...",       // SECRET
    "signingSecret": "..."        // SECRET
  },
  "reactions": { ... },           // Not secret
  "repositories": [ ... ]         // Not secret
}
```

**After:**
- `data/auth/slack.json` - Slack secrets only
- `data/config.json` - Everything else (no secrets)
