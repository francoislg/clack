# CLAUDE.md

## Project Overview

**Clack** (Claude + Slack) — A self-hosted Slack bot that answers codebase questions using Claude Code. React to any message with a configured emoji, and Clack provides non-technical answers visible only to you. Accept to share with the team, refine for better answers, or reject to dismiss. Also supports an optional **Changes Workflow** where users can request code changes, commits, and PRs directly from Slack.

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

### Two Processing Modes

1. **Query mode** — `processMessage()` in `src/slack/handlers/core.ts` orchestrates Q&A sessions. Claude calls tools from `src/tools/query/` and `src/tools/actions/`, then must call `submit_response` to deliver its answer.
2. **Worker mode** — `executeChange()` in `src/changes/execution.ts` runs Claude in a git worktree with tools from `src/tools/worker/` to make commits and manage PRs.

### Internal MCP Tools (`src/tools/`)

Claude is given a local MCP server (built in `src/tools/server.ts`). Key rules:
- Claude **must** call `submit_response` to deliver answers — it cannot just print text
- Action tools (`propose_change`, `request_review`, etc.) stage intents that become Slack buttons
- Worker tools (`git_push`, `ensure_pr`, etc.) are only available in the Changes Workflow

### Role System (4 tiers)

`owner` > `admin` > `dev` > `member` — persisted in `data/state/roles.json`

### Instruction System (two-tier)

- `data/default_configuration/` — shipped defaults (checked into git)
- `data/configuration/` — user overrides (gitignored, takes precedence)
- Template variables like `{BOT_NAME}` are substituted at runtime (see `src/instructionVariables.ts`)

### Data Directory Layout

All runtime data lives in `data/` (mostly gitignored):
- `config.json` — main runtime config
- `auth/` — credentials (slack.json, github.json, .env, github-app.pem)
- `repositories/` — cloned repos
- `sessions/` — persisted Q&A sessions
- `worktrees/` — git worktrees for Changes Workflow
- `worktree-sessions/` — persisted change sessions
- `state/` — roles, user preferences, migration version

### Migrations

Numbered migrations in `src/migrations/`. Two priorities: `blocking` (run before startup) and `enhancement` (run in background). Version tracked in `data/state/migration-version.json`. Use `/create-migration` to scaffold new migrations.

## Source Structure

```
src/
├── index.ts              # Entry point and startup sequence
├── config.ts             # Config loading, validation, paths
├── claude.ts             # Claude Agent SDK integration
├── mcp.ts                # MCP server config, GitHub MCP auto-config
├── sessions.ts           # Q&A session lifecycle
├── repositories.ts       # Git clone/pull/sync
├── worktrees.ts          # Git worktree management
├── github.ts             # GitHub App auth, Octokit
├── roles.ts              # User role system
├── permissions.ts        # Permission checks
├── instructions.ts       # Instruction file loading
├── slack/                # Slack-specific layer
│   ├── app.ts            # Bolt app setup, handler registration
│   ├── blocks.ts         # Block Kit builders
│   └── handlers/         # One file per Slack action/event
├── tools/                # Internal MCP tool server for Claude
│   ├── server.ts         # Tool assembly
│   ├── query/            # Read-only tools (list_repositories, find_sessions, etc.)
│   ├── actions/          # Intent-staging tools (propose_change, etc.)
│   ├── presentation/     # submit_response
│   └── worker/           # Changes Workflow tools (git_push, ensure_pr, etc.)
├── changes/              # Changes Workflow orchestration
└── migrations/           # Data migration system
```

## OpenSpec Workflow

This project uses OpenSpec for spec-driven development.

**For new features, breaking changes, or architectural decisions:**

1. Read `openspec/AGENTS.md` for the full workflow
2. Run `openspec list` to see active changes and `openspec list --specs` to see existing capabilities
3. Create proposals in `openspec/changes/[change-id]/` with `proposal.md`, `tasks.md`, and spec deltas
4. Validate with `openspec validate [change-id] --strict` before implementation

**Skip proposals for:** bug fixes, typos, dependency updates, config changes.

## Migrations

When creating boot migrations, **always use `/create-migration`**. This skill scaffolds the migration file, registers it, creates test cases, and registers them in the test runner. Never create migration files manually.
