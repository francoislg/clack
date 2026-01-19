# Design: Docker Setup

## Context
Clack requires multiple credentials to run:
1. **SSH key** - For cloning private Git repositories
2. **ANTHROPIC_API_KEY** - For Claude Agent SDK API calls
3. **Slack tokens** - Bot token, app token, signing secret

These need to be available in Docker without being committed to git.

## Goals
- Single script to configure all Docker prerequisites
- All credentials stored in gitignored `data/auth/` directory
- Clear separation of secrets from non-sensitive configuration
- Clear validation and error messages
- Instructions for GitHub SSH key approval

## Non-Goals
- Docker Compose orchestration (out of scope per user request)
- CI/CD pipeline configuration
- Secret management services (Vault, AWS Secrets Manager)

## Decisions

### Decision: Store all credentials in `data/auth/`
**Why**: Keeps all secrets in one gitignored location. Non-sensitive config stays in `data/config.json`.

**Structure**:
- `data/auth/ssh/` - SSH keys for Git
- `data/auth/slack.json` - Slack tokens
- `data/auth/.env` - ANTHROPIC_API_KEY

**Alternatives considered**:
- Keep Slack tokens in config.json - mixes secrets with non-secrets
- Environment variables only - SSH keys require files, inconsistent approach

### Decision: Separate Slack credentials from config.json
**Why**:
- Clear separation of secrets from configuration
- `data/config.json` can be safely committed (example configs)
- All secrets in one place for Docker mounting
- Easier to rotate credentials without touching config

**Migration**: Config loading in `src/config.ts` will merge both files at runtime.

### Decision: Generate SSH keys in script rather than requiring import
**Why**: Simplest path for new deployments. Import option available for existing keys.

### Decision: Store API key in `data/auth/.env` file
**Why**:
- Consistent file-based approach with SSH keys
- Easy to mount in Docker
- Can be sourced by setup script for validation
- Docker `--env-file` flag support

**Alternatives considered**:
- Prompt at `docker run` time only - error-prone, no persistence
- Inline in Dockerfile - security risk

### Decision: Install Claude Code CLI in Docker image
**Why**: The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) requires Claude Code as its runtime. Per the [Agent SDK docs](https://platform.claude.com/docs/en/agent-sdk/overview), the CLI must be installed.

### Decision: Use multi-stage build
**Why**: Smaller final image by excluding dev dependencies and TypeScript source.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Image                            │
├─────────────────────────────────────────────────────────────┤
│  Node.js 18 Alpine                                          │
│  + git, openssh-client                                      │
│  + Claude Code CLI                                          │
│  + Built application (dist/)                                │
├─────────────────────────────────────────────────────────────┤
│                     Volumes                                 │
├──────────────────┬──────────────────┬──────────────────────┤
│  data/config.json │  data/auth/      │  data/repositories/  │
│  (read-only)      │  (all secrets)   │  (read-write)        │
└──────────────────┴──────────────────┴──────────────────────┘
```

## Config Loading Flow

```
src/config.ts
│
├─► Load data/config.json
│   └─► Contains: reactions, repos, git settings, sessions, claudeCode
│
├─► Load data/auth/slack.json
│   └─► Contains: botToken, appToken, signingSecret
│
└─► Merge into unified Config object
    └─► Validate all required fields present
```

## Script Flow

```
docker-setup.sh
│
├─► Check: data/config.json exists?
│   └─► No → Offer to copy from config.example.json
│       └─► Open in $EDITOR for customization
│
├─► SSH Key Setup
│   ├─► Exists in data/auth/ssh/?
│   │   └─► Yes → Use existing
│   └─► No → Prompt: Generate new or import?
│       ├─► Generate → ssh-keygen (ED25519)
│       └─► Import → Copy from provided path
│
├─► Display GitHub SSH Instructions
│   └─► cat data/auth/ssh/id_rsa.pub + URL
│
├─► Slack Credentials Setup
│   ├─► Exists in data/auth/slack.json?
│   │   └─► Yes → Validate format
│   └─► No → Prompt for each:
│       ├─► Bot Token (xoxb-...)
│       ├─► App Token (xapp-...)
│       └─► Signing Secret
│
├─► ANTHROPIC_API_KEY Setup
│   ├─► Exists in data/auth/.env?
│   │   └─► Yes → Validate format
│   └─► No → Prompt for key, save to .env
│
├─► Validation
│   ├─► SSH key permissions (600)
│   ├─► Slack tokens format validation
│   ├─► API key format (sk-ant-*)
│   └─► config.json readable
│
└─► Output: Docker build + run commands
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| SSH key in image if not careful | Use volumes, never COPY credentials |
| API key exposure in logs | Mask in script output |
| Claude Code CLI large (~100MB) | Accept for simplicity; could optimize later |
| Breaking change for existing users | Clear migration instructions, script detects old config |

## Migration Path
For existing users with Slack tokens in `config.json`:
1. Setup script detects tokens in old location
2. Offers to migrate automatically to `data/auth/slack.json`
3. Updates `config.json` to remove tokens

## Maintenance Notes

### Script Dependencies
The following scripts share assumptions about the auth directory structure:
- `scripts/docker-setup.sh` - Creates auth files locally
- `scripts/gce-deploy.sh` - Copies auth files to GCE and runs container

**If you change one, review the other.** Specifically:
- Auth file locations (`data/auth/slack.json`, `data/auth/.env`, `data/auth/ssh/`)
- Environment variable names (`ANTHROPIC_API_KEY`)
- Volume mount paths in docker run commands

### Future Improvements
- [ ] Add health check endpoint for monitoring
- [ ] Add `deploy:fly` or `deploy:railway` for alternative hosting
- [ ] Consider Secret Manager integration for GCE (instead of copying files)
- [ ] Add `npm run logs` shortcut for viewing GCE logs
- [ ] Add automated backup of `data/repositories/` volume

## Open Questions
None - approach is straightforward.
