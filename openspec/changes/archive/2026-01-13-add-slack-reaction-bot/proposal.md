# Change: Add Clack - Slack Reaction Bot with Claude Code Integration

## Why

Teams need a way to get quick, non-technical answers about their codebase directly in Slack without switching context. By reacting to a message with a configurable emoji, users can trigger an AI assistant (powered by Claude Code) that understands the codebase and provides helpful answers. The ephemeral response workflow (invisible → accept/reject/refine) ensures answer quality before sharing with the team.

## What Changes

- **Slack Integration**: Bot listens for a configurable reaction emoji on any message. When triggered, reads the message (and thread context) and generates an answer.
- **Ephemeral Response Flow**: Initial response is only visible to the user who reacted. Three actions available:
  - **Accept**: Makes the answer visible to everyone in the thread
  - **Reject**: Dismisses the ephemeral message
  - **Refine**: Opens a modal to add specific instructions, regenerates answer
  - **Update**: Re-reads the message/thread and regenerates (useful if context changed)
- **Multi-Repository Support**: Config supports multiple git repositories. Claude Code determines which repo(s) to search based on the question context.
- **Repository Management**: Clones configured repositories locally with SSH authentication. Periodic pull (configurable interval, default hourly) keeps repos up to date.
- **Claude Code Integration**: Spawns `claude` CLI subprocess per request. Session state persisted in `data/sessions/*`. Read-only access to `data/repositories/*`, write access to session folder.
- **Session Timeout**: Sessions expire after 15 minutes of inactivity. Accept/Reject/Refine/Update actions reset the timeout.
- **Configuration**: `data/config.json` contains all settings (reaction emoji, repositories, pull interval, etc.)

## Impact

- Affected specs: Creates 4 new capabilities
  - `slack-reaction-trigger` - Reaction detection and response flow
  - `claude-code-integration` - Claude CLI invocation and permissions
  - `repository-management` - Git operations and sync
  - `session-management` - Session lifecycle and state persistence
- Affected code: New project, all code is new
- External dependencies:
  - Slack Bolt SDK (for Slack integration)
  - Claude Code CLI (installed separately)
  - Git (for repository operations)
  - SSH key access (for private repositories)
