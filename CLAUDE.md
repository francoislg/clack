# CLAUDE.md

## Project Overview

**Clack** (Claude + Slack) — A self-hosted Slack bot that answers codebase questions using Claude Code. Supports three trigger modes (reactions, DMs, @mentions), a role-based permission system, and an optional **Changes Workflow** for proposing code changes, creating PRs, and merging — all from Slack.

## Tech Stack

- **Language:** TypeScript 5.7 (strict mode), ES2022 target, ESM (`"type": "module"`)
- **Runtime:** Node.js 20+ (Dockerfile pins `node:22-alpine`; some MCP deps like `@google-cloud/observability-mcp` require Node 20)
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

**Linter:** **oxlint**, not ESLint. Run `npx oxlint <files>`.

**Formatter:** **oxfmt**, not Prettier. Run `npx oxfmt <files>` to fix. Do NOT run `prettier --write` — its output differs from oxfmt's and the pre-commit hook will still reject the commit.

**Pre-commit hook (lefthook):** runs three checks in parallel on staged files — `oxlint`, `oxfmt --check`, and the full `npm test` suite. All three must pass. If `oxfmt --check` fails, run `npx oxfmt` on the flagged files and re-stage.

## Key Conventions

- **ESM imports must use `.js` extensions** even when importing `.ts` files (NodeNext module resolution requirement)
- Functional style preferred; minimal class usage
- `async/await` throughout; no raw Promise chains
- Explicit TypeScript types; avoid `any`
- **User-facing strings emitted by TypeScript code MUST go through `t()`** from `src/i18n/t.js`. Add the key to `src/i18n/strings/en.ts` (source of truth) and `src/i18n/strings/fr.ts` (parity test enforces). Internal logs, dev-facing console messages, and tool descriptions Claude reads stay English.

## Architecture

### Three Trigger Modes

- **Reactions** — User reacts with configured emoji. Response is ephemeral (only the reactor sees it) or delivered via DM (DM-first mode). User accepts to share publicly.
- **Direct Messages** — User messages the bot directly. Responses posted visibly in thread. Thread replies continue the conversation.
- **@Mentions** — User @mentions the bot in a channel. Responses posted visibly in thread.

Each mode is independently configured with its own thinking indicator and Changes Workflow toggle.

**Stop reaction** (`config.reactions.stop`, default `octagonal_sign` / 🛑) — reacting with the configured emoji on any message in a thread, OR typing it inline in a short message (≤60 chars), cancels any in-flight Claude work for the thread and silences auto-respond for that thread. Clicking any change-thread action button re-engages the thread. Set `config.reactions.stop` to `null` or an empty string to disable.

### Two Processing Modes

1. **Query mode** — `processMessage()` in `src/slack/handlers/core.ts` orchestrates Q&A sessions. Claude calls tools from `src/tools/query/` and `src/tools/actions/`, then must call `submit_response` to deliver its answer.
2. **Worker mode** — `executeChange()` in `src/changes/execution.ts` runs Claude in a git worktree with tools from `src/tools/worker/` to make commits and manage PRs.

### Internal MCP Tools (`src/tools/`)

Claude is given a local MCP server (built in `src/tools/server.ts`). Key rules:

- Claude **must** call `submit_response` to deliver answers — it cannot just print text
- Action tools (`propose_change`, `request_update`, etc.) stage intents that become Slack buttons
- Worker tools (`git_push`, `ensure_pr`, etc.) are only available in the Changes Workflow
- **Multi-message responses** — `submit_response` accepts optional `additional_messages` (each posted as a **separate top-level channel message** alongside the primary) and `thread_replies` (each posted as a **threaded reply** under the primary's ts when posted top-level, otherwise in the existing thread). Same fields exist on every `post_to` action (cross-posted equivalents). **Both fields are always available in the schema in every trigger context** — discipline is prompt-only: Claude is instructed to use them ONLY when the user explicitly asks for multiple messages. Cap on `additional_messages` is configurable via `submitResponse.maxAdditionalMessages` (default 5, range `[1, 10]`); `thread_replies` capped at a fixed 20.

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
- Per-repo instructions: `{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`, optional `{repo}/worktree_install_instructions.md` (light pre-work install — runs on every branch switch when reusable pool is active), optional `{repo}/worktree_dirty_ignore.txt` (npm-style globs excluded from the dirty-quarantine check)
- Admins can edit instruction overrides from the Home Tab
- **Baseline vs topic files**: `{role}/*.md` at the top level are _baseline_ files — always loaded. `{role}/topics/<topic>/*.md` are _topic_ files — loaded only when `attach_integration("<topic>")` activates that topic mid-session. Both layers cascade through the role chain (member → dev → admin → owner) the same way; baseline resolution explicitly skips the `topics/` folder. See `src/cascadingConfigResolver.ts` and the MCP registry in `data/config.json` (`mcpServers: { <name>: { alwaysLoad, description } }`) which governs which integrations get lazy-loaded via the catalog

### Changes Workflow

Optional feature (gated by `changesWorkflow.enabled`). Dev+ users request changes → Claude creates a git worktree, implements changes, pushes a branch, opens a PR. Follow-ups (review, update, merge, close) happen in the same Slack thread. A background monitor detects externally merged/closed PRs and cleans up worktrees.

#### Worktree models — disposable vs reusable pool

Two worktree models behind a config flag (`changesWorkflow.reusableFolders.enabled`, default `false`):

- **Disposable** (default): each change creates a fresh `data/worktrees/<repo>/<branch-name>/` directory, runs full setup (`worktree_setup_instructions.md` — e.g. `pnpm install`), and `rm -rf`s it when the PR closes. Setup cost paid on every request.
- **Reusable pool**: a bounded pool of long-lived `data/worktrees/<repo>/worker-N/` folders. Each worker runs the heavy setup once at creation; subsequent requests on different branches reuse the worker via `git checkout -B <branch> origin/<default>` and run only the idempotent `worktree_install_instructions.md` step (e.g. `pnpm install --frozen-lockfile`). Workers persist their state in `data/state/workers.json` + `<worker>/.clack-worker-state.json` sidecars.

Reusable pool config block (under `changesWorkflow.reusableFolders`):
- `enabled` — turn the pool on
- `minimumProvisioned` — workers warmed at boot per repo (sequential per-repo to avoid port-allocation races; start with 1)
- `maxConcurrent` — hard cap on pool size per repo
- `maxQueueDepth` — FIFO queue bound; requests beyond this are rejected with `PoolExhausted`
- `idleReleaseHours` — busy workers idle past this duration on a `pr_created` session with no live handle get detached (clean: `git checkout origin/<default>` + clear claim, the session re-acquires on the next follow-up) or quarantined (dirty)
- `dirtyTrackedQuarantine` — when modified-tracked files are present at release/switch, the worker is quarantined instead of releasing; the owner gets a DM and admins see a "Discard & restore" button in the Home Tab

The pool implementation lives in `src/workers/`. `DisposablePool` and `ReusablePool` both implement `WorkerPool` from `src/workers/types.ts`; the factory in `src/workers/index.ts` picks based on the config flag. `src/changes/workflow.ts`, `src/changes/monitor.ts`, and `src/changes/restore.ts` depend on the abstract interface.

### Trivia plugin: optional Seasons

The trivia plugin ships an optional **seasons** feature, gated by `config.trivia.seasons = { enabled, prompt }`. When enabled:

- Each question / answer / cheat record carries a `season: string` tag stamped at write time.
- `data/plugins/trivia/seasons.json` tracks `{ current, currentStartedAt, currentExpectedEndAt, currentCategories, history[] }`. The plugin creates this file on first boot after enabling, seeded from `categories.json` (which becomes the persistent baseline that every new season starts from).
- Two new admin-gated MCP tools: `check_season_status` (reads the reveal cron and tells Claude whether today is the season's last fire) and `start_new_season(slug, expectedEndAt, themeExtras?)` (closes the current season and promotes a new one). The same tool serves both auto-rollover (final step of the season-end reveal) and admin-initiated mid-season rollover.
- `add_categories` / `remove_categories` gain a `target: "current" | "default" | "both"` arg (default `"both"`), letting admins make a category usable just this season, just future seasons, or both.
- `get_ideas` reads from `currentCategories` when enabled; `save_question` validates against it; `find_previous_questions` defaults to scanning across all seasons (for duplicate detection), while `retrieve_scores` defaults to the current season (for the "today's standings" view).
- The reveal flow renders a 3-row leaderboard table (Current Season + All Time, medals awarded independently per row) and, on the season's last fire, an additional finale section above the table.

When `trivia.seasons.enabled` is `false` or absent, behavior is identical to pre-seasons trivia in every observable respect.

### Trivia question generation: four-axis composition

Question generation is factored into four orthogonal axes, each weighted-random rolled by `get_ideas` and honored by `save_question`:

- **`answersFormat: "boolean" | "choice"`** — the answer shape (renamed from the legacy `type` field as of migration 021). Cascade: `slot.answersFormat → season.answersFormat → config.trivia.answersFormat → { boolean: 1, choice: 0 }`.
- **`questionType: "fact" | "topical"`** — `fact` is static knowledge; `topical` REQUIRES Claude to use the `WebSearch` tool to find a recent newsworthy event and capture a `sourceUrl` (mandatory on topical records) plus optional `eventDate`. Cascade: same shape. Default `{ fact: 1, topical: 0 }` — zero topical until an admin opts in.
- **`category`** — drawn uniformly at random from the active pool (slot → season → global `categories.json`). Flat string list; no per-category weights.
- **`contexts` (optional lens)** — when configured, `get_ideas` returns a freshly-rolled `contextPriority: string[]` (weighted-random ordering of the configured `Array<{ name; weight? }>`). Claude tries lenses in order and descends only when the current lens yields no usable question. Empty-string entries mean "no specific lean." Cascade: `slot.contexts → season.contexts → config.trivia.contexts`. Absent at every tier → no `contextPriority` returned and Claude generates without a lens (today's behavior).

The four axes compose multiplicatively into four generation paths (`fact-boolean`, `fact-choice`, `topical-boolean`, `topical-choice`), each implemented as its own branch in `SEND_QUESTIONS_INSTRUCTIONS`. Topical paths share the polarity/distractor/difficulty gates with their fact-path siblings but add a WebSearch research step at the front.

Stored question records (`data/plugins/trivia/games/*/questions.json`) carry `answersFormat`, `questionType`, and optionally `context`, `sourceUrl`, `eventDate`. Reveal behavior is determined by `answersFormat` only — topical and fact questions of the same shape render identically.

### Data Directory Layout

All runtime data lives in `data/` (mostly gitignored):

- `config.json` — main runtime config
- `auth/` — credentials (slack.json, github.json, .env, github-app.pem)
- `repositories/` — cloned repos
- `sessions/` — persisted Q&A sessions
- `worktrees/` — git worktrees for Changes Workflow (`<repo>/<branch>/` in disposable mode, `<repo>/worker-N/` in reusable mode)
- `worktree-sessions/` — persisted change sessions
- `state/` — roles, user preferences, migration version, `workers.json` (reusable pool state)
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
│   ├── monitor.ts        # Background PR status monitor + idle-release sweep
│   ├── pr.ts             # PR template resolution
│   ├── persistence.ts    # Change session persistence
│   ├── restore.ts        # Session restoration after restart
│   ├── askClaudeWorktree.ts # Claude invocation in worktree
│   └── types.ts          # Change types
├── workers/              # Worker-pool implementation (used by changes/)
│   ├── types.ts          # WorkerPool interface, Worker record, queue entry
│   ├── index.ts          # Factory, singleton accessor, boot init + helpers
│   ├── disposablePool.ts # Per-branch disposable model (default)
│   ├── reusablePool.ts   # Long-lived worker-N folders with queueing
│   ├── persistence.ts    # workers.json + sidecar I/O + disk reconciliation
│   ├── queue.ts          # Per-repo FIFO with cancellable entries
│   ├── branchSwitch.ts   # git checkout + dirty-quarantine on switch
│   ├── quarantine.ts     # Dirty-file detection, sidecar I/O, ignore globs
│   ├── setupVersion.ts   # Hash of worktree_setup_instructions.md
│   ├── errors.ts         # PoolExhausted, DirtyWorkerQuarantined, etc.
│   └── quarantineNotifier.ts # Owner DM on quarantine
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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:

- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
