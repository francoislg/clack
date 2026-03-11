# CLAUDE.md

## Project Overview

**Clack** (Claude + Slack) — A self-hosted Slack bot that answers codebase questions using Claude Code. Supports three trigger modes (reactions, DMs, @mentions), a role-based permission system, and an optional **Changes Workflow** for proposing code changes, creating PRs, and merging — all from Slack.

## Tech Stack

- **Language:** TypeScript 5.7 (strict mode), ES2022 target, ESM (`"type": "module"`)
- **Runtime:** Node.js 18+
- **Build:** `tsc` → `dist/` (no bundler)
- **Slack:** `@slack/bolt` v4 (Socket Mode)
- **AI:** `@anthropic-ai/claude-agent-sdk` (runs Claude Code CLI)
- **GitHub:** `@octokit/rest` + `@octokit/auth-app` (GitHub App auth) + auto-injected `github-mcp-server`
- **Git:** `simple-git`

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode (tsc --watch & node --watch)
npm run start        # Run compiled output
npm run test         # Run tests (node --test)
npx tsc              # Type-check without emitting (use to verify changes)
```

No ESLint configured — rely on TypeScript strict mode for correctness.

## Key Conventions

- **ESM imports must use `.js` extensions** even when importing `.ts` files (NodeNext module resolution requirement)
- Functional style preferred; minimal class usage
- `async/await` throughout; no raw Promise chains
- Explicit TypeScript types; avoid `any`

## Architecture

### Three Trigger Modes

- **Reactions** — User reacts with configured emoji. Response is ephemeral (only the reactor sees it) or delivered via DM (DM-first mode). User accepts to share publicly.
- **Direct Messages** — User messages the bot directly. Responses posted visibly in thread. Thread replies continue the conversation.
- **@Mentions** — User @mentions the bot in a channel. Responses posted visibly in thread.

Each mode is independently configured with its own thinking indicator and Changes Workflow toggle.

### Two Processing Modes

1. **Query mode** — `processMessage()` in `src/slack/handlers/core.ts` orchestrates Q&A sessions. Claude calls tools from `src/tools/query/` and `src/tools/actions/`, then must call `submit_response` to deliver its answer.
2. **Worker mode** — `executeChange()` in `src/changes/execution.ts` runs Claude in a git worktree with tools from `src/tools/worker/` to make commits and manage PRs.

### Internal MCP Tools (`src/tools/`)

Claude is given a local MCP server (built in `src/tools/server.ts`). Key rules:
- Claude **must** call `submit_response` to deliver answers — it cannot just print text
- Action tools (`propose_change`, `request_update`, etc.) stage intents that become Slack buttons
- Worker tools (`git_push`, `ensure_pr`, etc.) are only available in the Changes Workflow

Query tools (role-gated):
- `list_repositories`, `git_log`, `deepen_history` — available to all
- `find_sessions`, `find_changes`, `find_pull_requests`, `resolve_review_thread` — dev+ only
- `find_user` — available when Slack client is present
- `list_config_files`, `read_config_file` — admin+ only

Action tools:
- `propose_change`, `request_update` — dev+ with Changes Workflow enabled
- `propose_config_update` — admin+ only

Worker tools (in worktree context):
- `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `resolve_review_thread`, `report_status`

### Role System (4 tiers)

`owner` > `admin` > `dev` > `member` — persisted in `data/state/roles.json`

Managed via the Home Tab in Slack. Per-repo access control with `read` and `write` role thresholds.

### Instruction System (two-tier)

- `data/default_configuration/` — shipped defaults (checked into git)
- `data/configuration/` — user overrides (gitignored, takes precedence)
- Template variables like `{BOT_NAME}` are substituted at runtime (see `src/claude/promptBuilder.ts`)
- Per-repo instructions: `{repo}/changes_instructions.md` and `{repo}/worktree_setup_instructions.md`
- Admins can edit instruction overrides from the Home Tab

### Changes Workflow

Optional feature (gated by `changesWorkflow.enabled`). Dev+ users request changes → Claude creates a git worktree, implements changes, pushes a branch, opens a PR. Follow-ups (review, update, merge, close) happen in the same Slack thread. A background monitor detects externally merged/closed PRs and cleans up worktrees.

### Data Directory Layout

All runtime data lives in `data/` (mostly gitignored):
- `config.json` — main runtime config
- `auth/` — credentials (slack.json, github.json, .env, github-app.pem)
- `repositories/` — cloned repos
- `sessions/` — persisted Q&A sessions
- `worktrees/` — git worktrees for Changes Workflow
- `worktree-sessions/` — persisted change sessions
- `state/` — roles, user preferences, migration version
- `default_configuration/` — shipped instruction defaults
- `configuration/` — user instruction overrides (gitignored)

### Migrations

Numbered migrations in `src/migrations/`. Two priorities: `blocking` (run before startup) and `enhancement` (run in background, Claude-powered). Version tracked in `data/state/migration-version.json`. Use `/create-migration` to scaffold new migrations.

## Source Structure

```
src/
├── index.ts              # Entry point and startup sequence
├── config.ts             # Config loading, validation, paths
├── claude/               # Claude Agent SDK integration
│   └── promptBuilder.ts  # System prompt assembly and template variable interpolation
├── mcp.ts                # MCP server config, GitHub MCP auto-config
├── sessions.ts           # Session lifecycle and persistence
├── repositories.ts       # Git clone/pull/sync
├── worktrees.ts          # Git worktree management
├── github.ts             # GitHub App auth, Octokit
├── roles.ts              # User role system
├── permissions.ts        # Permission checks
├── repoAccess.ts         # Per-repo access control
├── instructions.ts       # Instruction file loading
├── configurationFiles.ts # Configuration file management
├── userPreferences.ts    # User preference storage
├── logger.ts             # Logging
├── slack/                # Slack-specific layer
│   ├── app.ts            # Bolt app setup, handler registration
│   ├── blocks.ts         # Block Kit builders
│   ├── dmResponse.ts     # DM-first reaction response handling
│   ├── homeTab.ts        # Home Tab rendering
│   ├── messagesApi.ts    # Slack messages API helpers
│   ├── state.ts          # Session state management
│   ├── userCache.ts      # Individual user info cache
│   ├── usersCache.ts     # Workspace user list cache (find_user tool)
│   └── handlers/         # One file per Slack action/event
├── tools/                # Internal MCP tool server for Claude
│   ├── server.ts         # Tool assembly and gating
│   ├── types.ts          # Tool type definitions
│   ├── context.ts        # Tool context builders
│   ├── query/            # Read-only tools (list_repositories, find_sessions, etc.)
│   ├── actions/          # Intent-staging tools (propose_change, etc.)
│   ├── presentation/     # submit_response
│   └── worker/           # Changes Workflow tools (git_push, ensure_pr, etc.)
├── changes/              # Changes Workflow orchestration
│   ├── workflow.ts       # Change lifecycle
│   ├── execution.ts      # Worker-mode Claude execution
│   ├── detection.ts      # Change request detection
│   ├── monitor.ts        # Background PR status monitor
│   ├── pr.ts             # PR template resolution
│   ├── persistence.ts    # Change session persistence
│   ├── restore.ts        # Session restoration after restart
│   ├── askClaudeWorktree.ts # Claude invocation in worktree
│   └── types.ts          # Change types
└── migrations/           # Data migration system
    ├── boot.ts           # Blocking migration runner
    ├── engine.ts         # Claude-powered migration engine
    └── 001-*.ts … 005-*  # Individual migrations
```

## OpenSpec Workflow

This project uses OpenSpec for spec-driven development.

**For new features, breaking changes, or architectural decisions:**

1. Read `openspec/project.md` for project context
2. Run `openspec list` to see active changes and `openspec list --specs` to see existing capabilities
3. Create proposals in `openspec/changes/[change-id]/` with `proposal.md`, `tasks.md`, and spec deltas
4. Validate with `openspec validate [change-id] --strict` before implementation

**Skip proposals for:** bug fixes, typos, dependency updates, config changes.

## Migrations

When creating boot migrations, **always use `/create-migration`**. This skill scaffolds the migration file, registers it, creates test cases, and registers them in the test runner. Never create migration files manually.
