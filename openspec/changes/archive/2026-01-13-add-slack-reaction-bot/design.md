# Design: Clack Architecture

## Context

This bot bridges Slack conversations with Claude Code to answer codebase questions. Key constraints:
- Claude Code CLI must run as subprocess with specific filesystem permissions
- Responses must be ephemeral first, then optionally shared
- Multiple repositories supported, agent selects relevant one(s)
- Session state must persist to allow conversation continuation

## Goals / Non-Goals

**Goals:**
- Simple, reliable Slack → Claude Code pipeline
- Secure file access (read-only repos, write-only sessions)
- Configurable without code changes
- Non-technical answers for non-technical users

**Non-Goals:**
- Web UI or alternative interfaces
- Direct database access for Claude
- Real-time streaming responses (Slack doesn't support well)
- Multi-tenant SaaS deployment

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Slack Workspace                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────────┐  │
│  │ Message  │───▶│ Reaction │───▶│ Ephemeral Response       │  │
│  │          │    │ :emoji:  │    │ [Accept][Reject][Refine] │  │
│  └──────────┘    └──────────┘    └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Bot Server                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Slack Bolt  │  │ Session     │  │ Repository              │ │
│  │ App         │  │ Manager     │  │ Manager                 │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Claude Code Spawner                       ││
│  │  - Spawns `claude` CLI per request                          ││
│  │  - Passes session context and question                      ││
│  │  - Enforces filesystem permissions                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        File System                               │
│  data/                                                           │
│  ├── config.json          # Bot configuration                    │
│  ├── repositories/        # Cloned git repos (READ-ONLY)         │
│  │   ├── repo-a/                                                 │
│  │   └── repo-b/                                                 │
│  └── sessions/            # Session state (READ-WRITE)           │
│      └── {session-id}/                                           │
│          ├── context.json # Conversation context                 │
│          └── notes.md     # Claude's working notes               │
└─────────────────────────────────────────────────────────────────┘
```

## Decisions

### 1. Subprocess per Request (not long-running session)

**Decision:** Spawn a new `claude` CLI process for each question/refinement.

**Rationale:**
- Simpler to implement and debug
- Natural isolation between requests
- Session context passed explicitly via files
- Avoids complexity of managing long-running process stdin/stdout

**Trade-off:** Slightly higher latency per request, but cleaner architecture.

### 2. SSH Key Authentication for Repositories

**Decision:** Use SSH keys mounted in the environment for git authentication.

**Rationale:**
- Standard approach for server-side git access
- Works with any git host (GitHub, GitLab, Bitbucket, etc.)
- No token rotation concerns
- SSH agent can handle multiple keys

**Configuration:** Path to SSH key (or use default `~/.ssh/id_rsa`) in config.

### 3. Ephemeral Message with Interactive Buttons

**Decision:** Use Slack's ephemeral messages with Block Kit buttons for Accept/Reject/Refine/Update.

**Rationale:**
- Native Slack UX, no learning curve
- Only the reacting user sees initial response
- Accept converts ephemeral → visible thread reply
- Buttons provide clear action affordances

### 4. Multi-Repository with Agent Selection

**Decision:** Configure multiple repos in config.json; Claude Code decides which to search.

**Rationale:**
- Avoids complex per-channel configuration
- Leverages Claude's reasoning to pick relevant repos
- System prompt instructs Claude on available repos and their purposes
- Single-repo is just a special case (one entry in config)

### 5. Filesystem Permission Enforcement

**Decision:** Use Claude Code's `--allow-read` and `--allow-write` flags to restrict access.

**Rationale:**
- Claude Code has built-in permission controls
- Read-only for repos prevents accidental modifications
- Write access to sessions allows Claude to persist notes/state
- Clear security boundary

**Implementation:**
```bash
claude --allow-read "data/repositories/*" \
       --allow-write "data/sessions/{session-id}/*" \
       --print \
       --prompt "..."
```

### 6. Session Timeout with Activity Reset

**Decision:** 15-minute timeout, reset on any user interaction.

**Rationale:**
- Keeps sessions alive during active refinement
- Cleans up abandoned sessions automatically
- Balance between resource usage and user experience

**Implementation:** Store `lastActivity` timestamp in session context.json, cleanup job runs periodically.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Claude Code CLI changes | Pin CLI version, document minimum version |
| Large repos slow to clone | Shallow clone option, configurable depth |
| Rate limiting from Slack | Implement backoff, queue requests |
| SSH key security | Document key permissions, suggest deploy keys |
| Session state corruption | Atomic writes, validation on load |

## Configuration Schema

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
      "name": "main-app",
      "url": "git@github.com:org/main-app.git",
      "description": "Main application codebase",
      "branch": "main"
    },
    {
      "name": "docs",
      "url": "git@github.com:org/docs.git",
      "description": "Documentation and guides",
      "branch": "main"
    }
  ],
  "git": {
    "sshKeyPath": "~/.ssh/id_rsa",
    "pullIntervalMinutes": 60,
    "shallowClone": true,
    "cloneDepth": 1
  },
  "sessions": {
    "timeoutMinutes": 15,
    "cleanupIntervalMinutes": 5
  },
  "claudeCode": {
    "path": "claude",
    "model": "sonnet"
  }
}
```

## Open Questions

1. **Should we support multiple Slack workspaces?** Current design assumes single workspace. Multi-workspace would need per-workspace config or database.

2. **What happens if Claude Code CLI is not installed?** Startup check? Graceful error message?

3. **Should we log/audit questions and answers?** Privacy implications vs debugging needs.
