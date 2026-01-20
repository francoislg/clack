# Project Context

## Purpose
**Clack** (Claude + Slack) is a Slack bot that answers codebase questions using the Claude Agent SDK. Users react to any Slack message with a configured emoji, and Clack provides non-technical answers visible only to them. They can then accept (share with team), edit & accept, refine, update, or reject the answer.

## Tech Stack
- **Runtime**: Node.js 18+
- **Language**: TypeScript (ES modules)
- **Slack Integration**: @slack/bolt (Socket Mode)
- **AI Integration**: @anthropic-ai/claude-agent-sdk
- **Build**: tsc (TypeScript compiler)

## Project Conventions

### Code Style
- ES modules with `.js` extensions in imports
- Functional style preferred, minimal classes
- Async/await for all asynchronous operations
- Explicit typing, avoid `any`

### Architecture Patterns
- **Configuration**: Single JSON config file (`data/config.json`) with type-safe validation
- **Handlers**: Each Slack action/event has its own handler file in `src/slack/handlers/`
- **State**: In-memory session state with cleanup scheduler
- **Separation**: Config, sessions, repositories, and Claude integration are separate modules

### Testing Strategy
- Manual testing via Slack interactions
- No automated tests currently configured

### Git Workflow
- Main branch: `main`
- Feature branches for changes
- OpenSpec for spec-driven development of new features

## Domain Context
- **Ephemeral messages**: Slack messages visible only to one user; cannot be updated or deleted after posting
- **Reactions**: Slack emoji reactions on messages; used as the trigger mechanism
- **Thread context**: Slack thread messages provide conversation context for questions
- **Sessions**: Track user interactions with timeout-based cleanup (default 15 min)

## Important Constraints
- Claude Agent SDK requires Claude Code CLI to be installed and authenticated
- Bot needs appropriate Slack OAuth scopes (`reactions:read`, `reactions:write`, `chat:write`, `im:write`, `channels:history`, etc.)
- SSH key access required for private Git repositories
- Read-only access to repositories (Claude tools restricted to Read, Glob, Grep)

## External Dependencies
- **Claude Code CLI**: Must be installed locally; SDK uses it as runtime
- **Slack API**: Socket Mode connection for real-time events
- **Git repositories**: Cloned locally to `data/repositories/` for code exploration
