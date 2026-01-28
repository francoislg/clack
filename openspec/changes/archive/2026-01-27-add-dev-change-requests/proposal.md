# Change: Add Developer Change Request Workflow

## Why

Devs need the ability to request code changes through Slack and have Clack autonomously create PRs. Currently, Clack is read-only and only answers questions. This feature enables devs to trigger simple fixes or implementations by describing what they want, and Clack will create a worktree, make the changes, commit, and open a PR—all without user interaction during the autonomous phase.

## What Changes

- **Configuration**: Add top-level `changesWorkflow` config section defining workflow behavior, with nested per-trigger opt-in (`directMessages.changesWorkflow.enabled`, etc.)
- **Repository Configuration**: Add per-repo settings for worktree support (`supportsChanges`, `worktreeBasePath`, `pullRequestInstructions`)
- **Claude Code Integration**: New autonomous agent mode with write permissions (Edit, Write, Bash) sandboxed to worktree directory
- **Worktree Management**: Create/manage git worktrees under `data/worktrees/{repo-name}/{branch}`
- **PR Creation**: Autonomous PR creation following repo's best practices (template detection + fallback)
- **PR Review**: Read PR comments and implement requested changes in follow-up thread messages
- **PR Merge**: Merge PRs when requested by dev in thread
- **Thread Follow-ups**: Continue conversation in Slack thread for review/merge/additional changes
- **Role Enforcement**: Only users with `dev` role (or higher) can trigger change requests
- **Worker Visibility**: Real-time progress updates in Slack and session logging to `data/worktree-sessions/`
- **Docker Setup**: Update setup script with instructions for write-enabled workflows

## Impact

- Affected specs:
  - `claude-code-integration` - New autonomous agent mode with write tools
  - `docker-deployment` - Setup instructions for write permissions
  - `repository-management` - Worktree management
  - `user-roles` - Dev role check for change requests

- Affected code:
  - `src/config.ts` - New configuration types
  - `src/claude.ts` - Change detection instructions and response parsing
  - `src/repositories.ts` - Worktree creation/cleanup
  - `src/roles.ts` - Dev check for change authorization
  - `src/slack/handlers/directMessage.ts` - Change request routing
  - `src/slack/handlers/mention.ts` - Change request routing
  - `src/slack/handlers/newQuery.ts` - Reaction-based change requests
  - `src/slack/handlers/threadReply.ts` - Follow-up command handling
  - `src/slack/homeTab.ts` - Active workers display
  - `scripts/docker-setup.sh` - New prompts for change workflow setup
  - New file: `src/worktrees.ts` - Worktree lifecycle management
  - New module: `src/changes/` - Change request orchestration
    - `types.ts` - Type definitions
    - `session.ts` - In-memory session management
    - `persistence.ts` - Disk state and logging
    - `detection.ts` - Config helpers and repo detection
    - `execution.ts` - Claude execution and plan generation
    - `pr.ts` - PR operations (create, merge, close, review)
    - `workflow.ts` - Main workflow orchestration
    - `index.ts` - Re-exports
