# Project Context

## Purpose
**Clack** (Claude + Slack) is a self-hosted Slack bot that answers codebase questions using Claude Code. Three trigger modes (emoji reactions, DMs, @mentions), a 4-tier role system (owner > admin > dev > member), and an optional **Changes Workflow**: dev+ users request code changes from Slack, Claude implements them in a git worktree, pushes a branch, opens a PR, and follow-ups (review, update, merge, close) happen in the same thread. A plugin SDK hosts optional features (trivia, idler, casual-talk, …).

`CLAUDE.md` at the repo root is the authoritative deep reference — this file is the distilled context; when they disagree, CLAUDE.md wins.

## Tech Stack
- **Language**: TypeScript 5.7 (strict), ES2022 target, ESM (`"type": "module"`)
- **Runtime**: Node.js 20+ (Docker pins `node:22-alpine`)
- **Slack**: `@slack/bolt` v4 (Socket Mode)
- **AI**: `@anthropic-ai/claude-agent-sdk` (runs the Claude Code CLI)
- **GitHub**: `@octokit/rest` + `@octokit/auth-app`; **Git**: `simple-git`
- **Validation**: `zod` — mandatory for anything read from disk/config
- **Build**: `tsc` → `dist/` (no bundler); **Lint**: oxlint; **Format**: oxfmt (NOT ESLint/Prettier)
- **Tests**: vitest (`npm test`); lefthook pre-commit runs oxlint + `oxfmt --check` + the full suite

## Project Conventions

### Code Style
- ES modules with `.js` extensions in imports (NodeNext requirement)
- Functional style preferred, minimal classes; `async/await` throughout
- Explicit typing, avoid `any`
- Anything read from disk/config parses through a zod schema (fail-fast for boot config, permissive/graceful for persisted state — a too-strict state loader silently wipes real data)
- User-facing Slack strings go through `t()` / `sdk.t()` (EN+FR dictionaries, parity-tested); strings consumed by Claude (tool results, prompts) stay English

### Architecture Patterns
- **Two processing modes**: query mode (`processMessage`, Q&A with `submit_response` as the only delivery path) and worker mode (`executeChange`, runs in a git worktree with worker tools)
- **Internal MCP tools** (`src/tools/`): role-gated query tools, intent-staging action tools (become Slack buttons), worker tools
- **Handlers**: each Slack action/event has its own file in `src/slack/handlers/`
- **Plugins** (`src/plugins/<name>/`): everything flows through the `ClackSdk` interface; plugins never import bot core (hard rules in `src/plugins/CLAUDE.md`)
- **Instructions**: two-tier cascade — `data/default_configuration/` (shipped) overridden by `data/configuration/` (gitignored); baseline vs topic files; per-role cascade
- **State**: JSON files under `data/state/`, loaded via graceful zod readers; sessions persisted under `data/sessions/`

### Testing Strategy
- **Runner**: vitest; the full suite runs on every commit via lefthook
- **Unit vs integration split**: unit tests mock outside dependencies; tests that intentionally wire real components or hit real I/O use the `*.integration.test.ts` suffix and their own file — never mixed into a unit file
- **No real timers, subprocesses, or git in unit tests** (lint-enforced): `vi.useFakeTimers()`; mock boundaries like `src/repositories.ts`
- **Collaborators get exactly two treatments**: (1) the canonical fake from the nearest `testHelpers.ts` (e.g. trivia's `createFakeSdk`, `createInMemoryDataLayer`) used as-is, or (2) `vi.mock` the boundary and assert the interaction (`toHaveBeenCalledWith` + the mock's return value is what got persisted). Never hand-roll a stub that re-implements a dependency's behavior.
- **Fakes are open-closed**: a wrong or incomplete canonical fake is fixed at source in `testHelpers.ts`; a test needing a variant passes overrides (`createFakeSdk({ ... })`); locally shadowing a fake is never an option. `sdk.t`/`sdk.actionId` must never be overridden (guard-enforced).
- **A test file named for module X asserts X's OWN behavior** — a dependency's behavior is tested in the dependency's own file; capture-style overrides are `vi.fn()` instances asserted through the mock API
- Structural invariants are pinned by guard tests that grep source (e.g. `cascadeSingleImplementation.test.ts`, `testHelpers.guard.test.ts`)

### Git Workflow
- Main branch: `main`; commits land directly on `main` (no feature branches or PRs unless explicitly requested)
- OpenSpec for spec-driven development of new features; bug fixes and config changes skip proposals
- Never commit without being asked; pre-commit hook must pass (no lint-disable workarounds)

## Domain Context
- **Ephemeral messages**: Slack messages visible only to one user; cannot be updated or deleted after posting
- **Reactions**: emoji reactions trigger the bot; response is ephemeral or DM-first, user accepts to share
- **Thread context**: thread messages provide conversation context; thread replies continue sessions
- **Sessions**: persisted Q&A state keyed by thread; change sessions survive restarts
- **Worktrees**: Changes Workflow isolates each change in `data/worktrees/` (disposable per-branch, or a reusable worker pool behind a config flag)
- **Cron plugins**: scheduled jobs (trivia, idler) fire channelless prompts that deliver via `deliver_to`

## Important Constraints
- Claude Agent SDK requires the Claude Code CLI installed and authenticated
- Bot needs appropriate Slack OAuth scopes (varies by `dmType`; manifest is generated)
- GitHub App credentials required for private repos and the Changes Workflow
- Query mode is read-only on repos; worker mode writes ONLY inside its worktree
- Strings reaching Slack users directly must be localizable (EN/FR) — see Code Style

## External Dependencies
- **Claude Code CLI**: installed locally; the SDK uses it as runtime
- **Slack API**: Socket Mode connection for real-time events
- **GitHub**: App-auth Octokit + auto-injected `github-mcp-server`
- **Git repositories**: cloned to `data/repositories/` for code exploration
