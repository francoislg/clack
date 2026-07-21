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
- **Validate anything read from disk/config with a zod schema, not hand-rolled guards.** Any value loaded from a file or config — `config.json`, plugin config, persisted state (`data/state/*.json`, sidecars), `mcp.json`, action/modal payloads — MUST be parsed through a `zod` schema that is the single source of truth for shape + semantics + defaults. Do not hand-roll `typeof`/`Array.isArray` guards, blind `as` casts, or bespoke `isX()` type-guards over `JSON.parse(...)`. Two philosophies, pick by surface: **fail-fast** readers (boot config — `config.ts`/`configSchemas.ts`, `mcpPinned`, `allowlist`) `safeParse` → throw a formatted error; **graceful** readers (persisted state — workers, roles, prefs, cron jobs, sessions, etc.) stay **permissive** — model legacy/optional on-disk fields, and on mismatch log + return the existing default (`[]`/`null`/`{}`). A too-strict schema on a graceful reader silently **wipes real state**, so never add `.strict()`, enum-rejection, `.datetime()`, or date-coercion to a state loader unless you've confirmed no real file relies on the looser shape. Reuse `zodErrorToResult` (`src/plugins-sdk/zodResult.ts`; plugin code imports it from the `plugins-sdk` surface) for error formatting. See `zod-inventory.md` for the full surface map.
- **Strings on the DIRECT-to-Slack path MUST go through `t()`** (core, from `src/i18n/t.js`) or **`sdk.t()`** (plugins). A string is on the direct path when it reaches a Slack user _without_ passing back through Claude's `submit_response` — message text, Block Kit element, button/modal label, status indicator, thinking-card title, ephemeral notice, or DM. Add the key to `src/i18n/strings/en.ts` (source of truth) and `src/i18n/strings/fr.ts`; the parity test enforces key/placeholder parity AND that no FR value is left identical to EN (allowlist for legitimate identicals). Plugins register their own dictionary via `sdk.registerDictionary({ en, fr })` and resolve with `sdk.t()`.
- **Strings on the VIA-Claude path STAY English.** Tool results returned to Claude (`textResult`/`errorResult` envelopes), Claude-facing prompt instructions, and tool descriptions are consumed by Claude, which re-renders user-facing output in the configured language via the LANGUAGE directive. Routing these through `t()` is redundant and degrades Claude's reasoning — leave them English. Internal logs and dev-facing console messages also stay English.

## Test Conventions

- **Runner:** vitest. Import `describe`, `it`, `expect`, `vi.fn`, `vi.spyOn`, `vi.useFakeTimers` from `vitest`.
- **No real timers.** Never use `setTimeout` / `setInterval` in tests — use `vi.useFakeTimers()` + `vi.advanceTimersByTime()`. Lint-enforced.
- **No real subprocesses or git.** Never import `child_process` / `simple-git` from a test. Mock at the boundary (`src/repositories.ts`, etc.) with `vi.mock` or constructor-injected stubs. Lint-enforced for direct imports; the structural rule (mock the boundary) is on you.
- **No hand-rolled fakes.** A collaborator gets exactly one of two treatments: the canonical fake from the nearest test-helpers module (e.g. trivia's `createFakeSdk` in `testHelpers.fakeSdk.ts`, `createTriviaDataLayer` in `testHelpers.ts`) used as-is, or `vi.mock` at the boundary with interaction assertions (`toHaveBeenCalledWith` + assert the mock's return value is what got used/persisted). Never write a local stub that re-implements a dependency's behavior — it's a third implementation that drifts. Where a stateful collaborator's production implementation can run over faked I/O, the canonical fake DRIVES the real implementation under spies (`createTriviaDataLayer(sdk)` = the real `createSdkDataLayer` with every method a `vi.spyOn`) rather than reimplementing its behavior. Capture-style overrides (recording calls) should be `vi.fn()` instances asserted through the mock API, not closure-variable push arrays.
- **Fakes are open-closed, and never grow the interface.** If a canonical fake is wrong or missing behavior, fix it in its test-helpers module so every consumer benefits; if one test needs a variant, pass overrides (`createFakeSdk({ ... })`) or stub the member mock. A fake may WIDEN a member's type (e.g. `dmOwner: Mock<…>`) but must never ADD a member the production interface lacks — test-only affordances (seeding stores, inspecting files) live in the sibling `testHelpers` object returned beside the fake. Locally shadowing or re-implementing a fake is never an option. `sdk.t` / `sdk.actionId` / `sdk.viewCallbackId` have exactly one faithful rendering and are structurally unmockable (plain functions on `FakeSdk` — stubbing them is a compile error); hand-rolled collaborator literals and capture arrays are guard-enforced by `src/plugins/trivia/testHelpers.guard.test.ts`.
- **Construct fakes in `beforeEach` (or per test), never at module scope.** `restoreMocks: true` strips `vi.fn` default implementations between tests; per-test construction makes that a non-issue.
- **Substrate chooses scope; stubbing chooses the claim.** Unit and integration tests use the SAME canonical fakes — the difference is what they stub. A unit test stubs whatever its claim depends on (`data.forGame(g).loadQuestions.mockResolvedValue([q])`) and asserts the unit; an `*.integration.test.ts` file stubs nothing and exercises the real flow end to end. Seed a read by programming that read, never by invoking an unrelated write — a `find_previous_questions` test must not depend on `save_question` working. Write-path seeding belongs to integration tests, where the writes ARE the flow.
- **Integration escape hatch:** tests that intentionally hit real I/O use the `*.integration.test.ts` suffix and are exempt from the bans above.

## Architecture

### Three Trigger Modes

- **Reactions** — User reacts with configured emoji. Response is ephemeral (only the reactor sees it) or delivered via DM (DM-first mode). User accepts to share publicly.
- **Direct Messages** — User messages the bot directly. Responses posted visibly in thread. Thread replies continue the conversation. Sub-mode via `config.directMessages.dmType`, three siblings routed at boot in `src/slack/app.ts` (`registerAssistant` / `registerAgent` / `registerClassicDmHandlers`):
  - `"assistant"` (default) — legacy Slack Assistant API (`assistant_view`, Bolt's `Assistant` middleware, `assistant_thread_started`/`_context_changed` events). Slack is **deprecating** this experience.
  - `"agent"` — the current **Agent messaging experience** (`agent_view`). Requires Bolt 5. No `Assistant` middleware (its `isAssistantMessage` gate drops `thread_ts`-less agent messages); `src/slack/handlers/agent.ts` uses `app_home_opened` (tab `"messages"`) for DM-open + plain `message.im` for user turns (`thread_ts` optional), reusing classicDm's message path. Keeps the `assistant:write` scope for `assistant.threads.*` status/prompts. The `agent_view` workspace switch is **irreversible**. (Greeting / suggested-prompts / live status are a pending increment; core Q&A + thread continuity work.)
  - `"classic"` — low-level `message.im`, plain Messages-tab UX, no `assistant:write` / view feature. View-agnostic (works under `assistant_view` or `agent_view`), so it's the in-workspace fallback once `agent_view` is committed.

  **Switching `dmType` requires a full restart AND re-uploading the regenerated manifest** (the subscribed bot events differ between modes); a reinstall is only needed when the switch adds a scope. The Agent messaging experience needs `@slack/bolt` v5 + `@slack/web-api` ^8.
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
- **Multi-message responses** — `submit_response` accepts optional `additional_messages` (each posted as a **separate top-level channel message** alongside the primary, in the SAME channel as the trigger) and `thread_replies` (each posted as a **threaded reply** under the primary's ts when posted top-level, otherwise in the existing thread). **The top-level fields are gated to the scheduled (cron) trigger only** — in DM, @mention, reaction, auto-respond, thread-reply, and worker contexts the trigger channel is the user's conversation space, so the schema hides these fields and Claude can't accidentally spam multiple messages there (the right move in those contexts is a `post_to` action with an explicit `channel`). The same fields exist on every `post_to` action and are **always available** there regardless of trigger — `post_to` carries an explicit `channel`, so the destination is unambiguous. Cap on `additional_messages` is configurable via `submitResponse.maxAdditionalMessages` (default 5, range `[1, 10]`); `thread_replies` capped at a fixed 20.

Query tools (role-gated):

- `list_repositories`, `git_log`, `deepen_history` — available to all
- `find_sessions`, `find_changes`, `find_pull_requests`, `resolve_review_thread` — dev+ only
- `find_user` — available when Slack client is present
- `search_messages` — available to all when `config.allowPublicSearch` is on (see below)
- `list_config_files`, `read_config_file` — admin+ only

### Public message search (`allowPublicSearch`)

Optional, opt-in via top-level `config.allowPublicSearch: boolean` (fail-fast zod, default `false` → fully inert). When `true`, the manifest generator adds the `search:read.public` bot scope (conditionally in `buildScopes`, no `bot_events` change) and the `search_messages` query tool is registered (member tier, query mode only). The tool does **literal** (non-semantic) keyword search over public-channel message text via `client.apiCall("assistant.search.context", …)` with fixed `disable_semantic_search: true` / `channel_types: "public_channel"` / `content_types: "messages"`; the `@slack/web-api` version in use ships no typed method, hence `apiCall`. **Enabling requires re-uploading the manifest AND reinstalling the app to the workspace** — a bot token does not retroactively gain scopes; a stale token surfaces `missing_scope` as a distinct error (never an empty result set). Bot-token search needs Slack's `action_token`, minted only onto `message`/`app_mention` events — so `search_messages` works from **DM and @mention** triggers but not reactions or cron. The token is captured off the event in the handlers, threaded `ProcessMessageParams → AskClaudeOptions → QueryToolContext.actionToken`, and **never persisted** to the session. Sessions without a token still register the tool in a **degraded shape** (no `query` param, returns an error naming the working triggers, makes no API call) so Claude knows the capability exists and how to reach it. Search covers message **text** only — reaction usage stays the domain of `fetch_channel_messages`'s emoji-lore `lore_hint`.

Action tools:

- `propose_change`, `request_update` — dev+ with Changes Workflow enabled
- `propose_config_update` — admin+ only

Worker tools (in worktree context):

- `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `resolve_review_thread`, `report_status`

**Plugin tools** are registered via the plugin SDK. Tools added with `sdk.registerTool(...)` (or equivalently `sdk.mcpServer.registerTool(...)`) live on the plugin's always-on default server at `mcp__<plugin>__<tool>`. For on-demand tool groups (e.g., admin-only management surfaces), plugins call `sdk.registerMcpServer(name, { autoload: false, description })` and bind tools to the returned handle — those tools live at `mcp__<plugin>_<name>__<tool>` and only become available after Claude calls `attach_integration("<plugin>:<name>")`. See `src/plugins/trivia/index.ts` for the live example: the `trivia:management` on-demand server hosts the config-mutation tools (six, plus two more when seasons are enabled) and its admin instruction.

### Role System (4 tiers)

`owner` > `admin` > `dev` > `member` — persisted in `data/state/roles.json`

Managed via the Home Tab in Slack. Per-repo access control with `read` and `write` role thresholds.

### Instruction System (two-tier)

- `data/default_configuration/` — shipped defaults (checked into git)
- `data/configuration/` — user overrides (gitignored, takes precedence)
- Template variables like `{BOT_NAME}` are substituted at runtime (see `src/claude/promptBuilder.ts`)
- Per-repo instructions: `{repo}/changes_instructions.md`, `{repo}/worktree_setup_instructions.md`, optional `{repo}/worktree_install_instructions.md` (light pre-work install — runs on every branch switch when reusable pool is active), optional `{repo}/worktree_dirty_ignore.txt` (npm-style globs excluded from the dirty-quarantine check)
- Admins can edit instruction overrides from the Home Tab
- **Baseline vs topic files**: `{role}/*.md` at the top level are _baseline_ files — always loaded. `{role}/topics/<topic>/*.md` are _topic_ files — loaded only when the topic is active for a session. A topic is activated either by `attach_integration("<topic>")` mid-session (driven by the MCP registry in `data/config.json` → `mcpServers: { <name>: { alwaysLoad, description } }`) OR pre-attached at session start via `CronJobSpec.attachedTopics` (driven by plugins). Both layers cascade through the role chain (member → dev → admin → owner) the same way; baseline resolution explicitly skips the `topics/` folder. See `src/cascadingConfigResolver.ts`.
- **Built-in topics**: shipped instruction content can be topic-gated instead of baseline. The first is **`response-rendering`** (`user/topics/response-rendering/` — Block Kit formatting, Slack formatting, response style, rich submit-response composition; the baseline `submit-response.md` is a thin contract stub pointing at it). Attach policy: every interactive trigger (`directMessages`, `mentions`, `reactions`, `autoRespond`, `threadReply`, `channelReply`) auto-attaches it via a core constant (`src/claude/builtinTopics.ts`, merged/deduped with caller topics in `processMessage`); `scheduled` fires attach only what the cron job's `attachedTopics` declares — `create_scheduled_message` defaults new user schedules to `["response-rendering"]` (pass `[]` for a lean run), plugin specs declare explicitly (trivia question/reveal, idler summary, casual-talk yes; trivia prep/lock, idler syncs/work no). Backstops: an instructions-only catalog entry lets Claude self-attach mid-session, and `submit_response` appends an attach hint on formatting-class validation failures when the topic isn't loaded. Worker mode is unaffected (no cascade).
- **Plugin-contributed instructions**: plugins register baseline content with `sdk.addInstruction(role, filename, content)` and topic-scoped content with `sdk.addTopicInstruction(role, topic, filename, content)`. Both flow through the same virtual-defaults map and are overrideable by on-disk files — baseline at `data/configuration/<role>/<plugin>__<filename>.md`, topic at `data/configuration/<role>/topics/<topic>/<plugin>__<filename>.md`. Edits hot-reload via the existing config watcher. To auto-attach a topic when a plugin's cron job fires, set `attachedTopics: [...]` on the `CronJobSpec` passed to `sdk.reconcileCronJobs`.
- **Trivia's topic content**: the trivia plugin contributes `topics/trivia/persona`, `topics/trivia/reveal-tone`, and `topics/trivia/finale-tone` — pre-attached by every trivia cron spec. Cheating-detection guidance, block-layout contracts (FIVE-BLOCK question layout, reveal block layout, Round Summary format), and `GAME_CONTEXT_DIRECTIVE` stay inlined in `scheduledPrompts.ts` because they couple to tool contracts.

### Changes Workflow

Optional feature (gated by `changesWorkflow.enabled`). Dev+ users request changes → Claude creates a git worktree, implements changes, pushes a branch, opens a PR. Follow-ups (review, update, merge, close) happen in the same Slack thread. A background monitor detects externally merged/closed PRs and cleans up worktrees.

#### Worker settings injection (`data/worker-settings.json`)

Optional operator escape hatch. When `data/worker-settings.json` (gitignored) exists, `runClaude` forwards its **absolute** path to the Agent SDK `settings` option, injecting an operator-provided native Claude Code `settings.json` — PreToolUse command hooks and other native keys — into worker-mode Claude. Absent → the worker runs in SDK isolation mode exactly as before. The codebase stays fully generic (no hook-tool references); the built-in bash guard still fires alongside injected hooks; `permissions` rules are inert under the worker's `bypassPermissions` mode, so hooks are the enforcement path. The file is part of the standard deploy: `scripts/gce-update-image.sh` pushes the local copy to the VM on every deploy (absent locally → VM copy left untouched). See [`docs/worker-settings.md`](docs/worker-settings.md).

#### PR reviewer assignment (`requirePRReviewers`)

Optional, opt-in via `changesWorkflow.requirePRReviewers` (default `false`). When `true`, the worker prompt instructs Claude to choose reviewers and `ensure_pr` requests them (`octokit.pulls.requestReviewers`) after creating the PR, excluding the author (case-insensitive). Reviewer resolution maps Slack users → GitHub logins via a core `github` field on the user registry (`UserRecord.github.username`), settable by the `update_user` MCP tool (github editable by anyone; display_name self/admin-only). Claude resolves unmapped reviewers from the repo's collaborators (via the auto-injected `github-mcp-server`) joined by case-insensitive exact email; low-confidence (name-only) matches are ignored — never written, never requested. The flag is intent only: reviewer-request failures (missing scope, 422, unresolved list) **never fail PR creation** — they surface as a non-fatal `warning` in the `ensure_pr` result.

**GitHub App scope requirements** (only when `requirePRReviewers` is enabled): the GitHub App needs `repos.listCollaborators` (read) and `pulls.requestReviewers` (write). There is no fail-fast boot check — a missing scope degrades to a runtime warning, consistent with the never-fail-PR contract. The Slack `users:read.email` scope is optional and improves match quality.

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

#### Cold-PR resume acquire mode

`AcquireOptions.resumeRemoteBranch` (default `false`) makes `acquire` check a branch out from its **own** remote head (`origin/<branch>`) instead of re-branching from `origin/<default>`, preserving an existing PR's commits when continuing it; a missing remote branch throws `RemoteBranchNotFound` rather than clobbering. It threads `propose_change`'s `continue_existing_pr` → `StagedChangeIntent.resumeRemoteBranch` → `ChangePlan.resumeRemoteBranch` → `switchBranch`/`createWorktree`. The default fresh-branch path is unchanged. Used by the idler plugin to continue cold (worktree-reclaimed) PRs, and set unconditionally by tester runs (`run_test`).

#### Tester runs ("test this PR")

Optional feature gated by `config.tester` (`{ enabled, sidecarUrl, recordingsDir, appHost?, maxConcurrent?, dockerProxyUrl?, servicesBudgetMb?, serviceImageAllowlist? }` — fail-fast zod; `sidecarUrl`/`recordingsDir` required when enabled; fully inert otherwise). A **tester** is a reduced-privilege _derived worker_: same chassis (worktree acquisition on the PR branch via `resumeRemoteBranch: true`, `executeChange` entry), but a `kind: "test"` discriminator (`StagedChangeIntent.kind` → `ChangePlan.kind` → `WorkerToolContext.kind`) selects a different toolbelt and terminal deliverable — a **video recording uploaded to the Slack thread**, never a PR.

- **Trigger**: dev+ users say "test this PR" → Claude stages via the `run_test` action tool (registered only when tester + Changes Workflow are enabled). The intent flows through the normal change-action button.
- **Toolbelt** (`buildTesterTools` in `src/tools/server.ts`): `report_status`, `record_and_upload`, `remember`, plus the **Playwright MCP** attached for the run. NO `git_push`/`ensure_pr`/`merge_pr`/`close_pr`; git stays read-only (no authenticated-push-remote refresh, `Write`/`Edit` disallowed, bash guard blocks raw pushes).
- **Sidecar**: the official `mcr.microsoft.com/playwright/mcp` image runs as an opt-in `clack-playwright` container (`docker-compose.tester.yml`) on the shared `clack` network; video recording is enabled via its `--config` file (`docker/clack-playwright/config.json` → `browser.contextOptions.recordVideo`), writing into `data/tester/recordings` (visible to the main container through the existing `data/` mount). The main image has **zero Playwright footprint** — it registers the sidecar as a remote HTTP MCP server per tester run. Local dev: `appHost: "host.docker.internal"`, `sidecarUrl: http://localhost:8931/mcp` (compose file). GCP: `appHost: "clack"`, `sidecarUrl: http://clack-playwright:8931/mcp` — do NOT use compose there (COS lacks it); `scripts/gce-update-image.sh` reads `tester.enabled` from the local `data/config.json` on every deploy and mirrors the compose file as a plain `docker run`, joining both containers to a shared `clack` docker network (disabled → any stale sidecar is removed).
- **Lifecycle** (`src/tester/`): sidecar reachability is checked BEFORE any acquisition (unreachable → abort with a clear message); a tester slot (`maxConcurrent`, default 1) bounds concurrent runs; the prompt (`src/tester/prompt.ts`, per-repo overrides `test_instructions.md` + `tester_data_setup_instructions.md`) drives boot (bind `0.0.0.0`, write pid/port to `.clack-tester-app.json`) → health-check → seed → drive → `record_and_upload` (ffmpeg `webm→mp4` in the main image) → report. `teardownAppProcess` kills the app by tracked PID + its process group, a port sweep, and a worktree-cmdline `pgrep -f` sweep for stray supervisors (pnpm/nodemon) on every exit path, and the worker is released immediately — tester changes are terminal (no follow-up actions; recovery would escalate to the implement toolbelt).
- **Home Tab**: active tester runs render as a "N testing" line in the Workers section.
- **Per-repo tester services** (`src/tester/services.ts` + `servicesConfig.ts`, see [`docs/tester-services.md`](docs/tester-services.md)): a repo MAY declare service containers (MySQL, Redis, …) in `data/configuration/<repo>/tester_services.json` (zod fail-fast — absent file → no services; invalid file → the run ABORTS, deliberately diverging from the graceful `verification_checks.json` reader). The workflow gate provisions them AFTER the tester slot claim and BEFORE acquisition (remove stale `clack-svc-<repo>-*` → pull-if-missing → create with hard memory caps + tmpfs on the `clack` network as `clack-svc-<repo>-<name>` → start → 60s TCP readiness probe; all-or-nothing), tears them down in the same `finally` as the slot release, and advertises endpoints via a TEST SERVICES prompt section. Control plane is a `clack-docker-proxy` sidecar (`tecnativa/docker-socket-proxy`, containers+images endpoints only, never port-mapped on the VM) consumed by core code only — Claude never gets a docker tool. Guards: `serviceImageAllowlist` (exact match), Σ `memoryMb` ≤ `servicesBudgetMb`, `clack-svc-` name-prefix enforcement. Deploy scripts reserve `896 (playwright) + 64 (proxy) + servicesBudgetMb` out of the clack container's cap when the tester is enabled and remove both sidecars when disabled.

### Idler plugin: off-hours autonomy

Optional plugin (`src/plugins/idler/`, gated by its own `config.json` `enabled` + a non-empty `repoAllowlist` + a `reportingChannel`). A channelless, cron-driven plugin modeled on `casual-talk` that turns idle time into reviewed, mergeable progress. The schedule is anchored by an explicit **`workHours`** window (`{ start, end, tz, days }`) that names WHEN the idler works — it fires INSIDE this window (set `start > end` for an overnight window, e.g. `18→9` = 6 PM–9 AM; any interior slice like `19→20` = 7–8 PM is expressible). Four cooperating cron tasks (up to), scheduled so sync and work never overlap. Sync is split into two tiers to keep token cost proportional to real change: **light sync** (`specKey: sync-light`, read-only — memory-triage ONLY, picking up newly-remembered work; fires at `:45` every **`syncEveryHours`** hours (default 2, settable via `set_idler_config`) across the sync window EXCEPT the anchor hour; when the recall page holds nothing new it ends immediately via `skip_response`, and its prompt omits the ~6k-token fetch-instructions doc since triage needs only the repo allowlist) and **deep sync** (`specKey: sync`, read-only — the full-maintenance pass: quick-fetch + close-resolved, coldest-unit re-verification/parking/priority-recompute, memory triage, and external discovery covering ALL enabled sources in one fire; runs ONCE per sync-window day at the **anchor hour** — the hour just before the work window opens, so it primes the ledger for the first work fire). The sync window is an explicit **`syncHours`** window or, when absent, the **complement** of `workHours`; the anchor is that window's last hour — `workHours.start − 1` for the complement (i.e. just before work opens), or `syncHours.end − 1` for an explicit window (whose last hour need not precede work). Then **work** (~15 min, INSIDE `workHours` — advances one unit per fire along the `continue > triage > implement > review` ladder via `propose_change`+`auto`, query-mode triage/review, never merges), and **summary** (morning digest to `reportingChannel`, defaults to 9 AM via `summaryHour`). `syncEveryHours` governs the LIGHT cadence only; the deep fire is always exactly one per window-day. The idler runs **only on the window's days** — on all other days (e.g. weekends) nothing fires (no work, no sync), so review work doesn't pile up unbounded for devs. The window math lives in `heuristic.ts` (`windowHours`/`complementHours`/`thinHours` + `syncSchedule`/`buildDeepSyncCron`/`buildLightSyncCron`/`buildWindowCron`); admins set the windows via `set_idler_work_hours` / `set_idler_sync_hours` (the latter takes `clear: true` to revert to the computed complement). A single-hour sync window reconciles only the deep fire (no light). The `data/plugins/idler/ideas.json` ledger holds minimal state (`open` + `priority` + `source` + free-text + growing self-describing `references[]` with read/comment recipes and idempotency cursors), keyed by stable source entity (e.g. an issue/ticket id) for dedup. Behavior/contract instructions ship as a topic; sourcing lives in admin-editable `data/plugins/idler/fetch-instructions.md`. Safety rails: repo allowlist, per-fire/per-night action caps, never-auto-merge.

### Trivia plugin: optional Seasons

The trivia plugin ships an optional **seasons** feature, gated by `config.trivia.seasons = { enabled, prompt }`. When enabled:

- Each question / answer / cheat record carries a `season: string` tag stamped at write time.
- `data/plugins/trivia/seasons.json` tracks `{ current, currentStartedAt, currentExpectedEndAt, currentCategories, history[] }`. The plugin creates this file on first boot after enabling, seeded from `categories.json` (which becomes the persistent baseline that every new season starts from).
- Two new admin-gated MCP tools: `check_season_status` (reads the reveal cron and tells Claude whether today is the season's last fire) and `end_season({ game, force? })` (closes the current season and resolves the successor — promote a queued season, create a continuation, or, when the game sets `disableAfterRound: true`, no successor at all: the game winds itself down to `enabled: false`; on a seasonless game the wind-down fires at a board-clearing reveal instead, gated by `compute_answers`' report-only `windDown: { eligible: true }` payload field). The same tool serves auto-rollover (final step of the season-end reveal) and admin-initiated mid-season rollover (`force: true` — which on a `disableAfterRound` game also winds it down). Correcting a wound-down game is re-enable → fix → re-disable by hand.
- `add_categories` / `remove_categories` gain a `target: "current" | "default" | "both"` arg (default `"both"`), letting admins make a category usable just this season, just future seasons, or both.
- `get_ideas` reads from `currentCategories` when enabled; `save_question` validates against it; `find_previous_questions` defaults to scanning across all seasons (for duplicate detection), while `retrieve_scores` defaults to the current season (for the "today's standings" view).
- The reveal flow renders a 3-row leaderboard table (Current Season + All Time, medals awarded independently per row) and, on the season's last fire, an additional finale section above the table.

When `trivia.seasons.enabled` is `false` or absent, behavior is identical to pre-seasons trivia in every observable respect.

### Trivia question generation: four-axis composition

Question generation is factored into four orthogonal axes, each weighted-random rolled by `get_ideas` and honored by `save_question`:

- **`answersFormat: "boolean" | "choice"`** — the answer shape (renamed from the legacy `type` field as of migration 021). Cascade: `slot.answersFormat → season.answersFormat → config.trivia.answersFormat → { boolean: 1, choice: 0 }`.
- **`questionType: "fact" | "topical"`** — `fact` is static knowledge; `topical` REQUIRES Claude to use the `WebSearch` tool to find a recent newsworthy event and capture a `sourceUrl` (mandatory on topical records) plus optional `eventDate`. Cascade: same shape. Default `{ fact: 1, topical: 0 }` — zero topical until an admin opts in.
- **`category`** — drawn uniformly at random from the active pool (`slot → season → game → global categories.json`). Flat string list; no per-category weights. A game can carry its own `categories: string[]` (used when no season is active) — see `TriviaGame.categories`.
- **`contexts` (optional lens)** — when configured, `get_ideas` returns a freshly-rolled `contextPriority: string[]` (weighted-random ordering of the configured `Array<{ name; weight? }>`). Claude tries lenses in order and descends only when the current lens yields no usable question. Empty-string entries mean "no specific lean." Cascade: `slot.contexts → season.contexts → config.trivia.contexts`. Absent at every tier → no `contextPriority` returned and Claude generates without a lens (today's behavior).

The four axes compose multiplicatively into four generation paths (`fact-boolean`, `fact-choice`, `topical-boolean`, `topical-choice`), each implemented as its own branch in `SEND_QUESTIONS_INSTRUCTIONS`. Topical paths share the polarity/distractor/difficulty gates with their fact-path siblings but add a WebSearch research step at the front.

Stored question records (`data/plugins/trivia/games/*/questions.json`) carry `answersFormat`, `questionType`, and optionally `context`, `sourceUrl`, `eventDate`. Reveal behavior is determined by `answersFormat` only — topical and fact questions of the same shape render identically.

**`promptMedium` axis (optional visual questions).** A fifth orthogonal axis, `promptMedium: "text" | "image"`, cascades `slot → season → game → workspace → { text: 1, image: 0 }` like the weighted axes. When `get_ideas` rolls `"image"`, the question-generation prompt runs the VISUAL RESEARCH SUBFLOW: it picks an available `*_image_search__*` MCP tool fitting the rolled category, calls it, inspects the returned image inline (image-inspection + image-is-question gates), dedups via `find_previous_subjects` (subject-level, not statement-level), and saves `promptMedium: "image"` + a `media: { kind, url, altText, subjectId, title, license?, attribution? }` object. All 6 combinations of `image × {boolean, choice, freeform}` are permitted (claim template for boolean, identification for choice, typed-identification for freeform). The generation prompt adds a separate `image` block (`{ image_url: media.url, alt_text: media.altText }`) right after the question card, built directly from the record's `media` — the upstream HTTPS URL is used as-is (no Slack re-hosting). `post_questions` posts Claude's blocks unchanged. Reveal surfaces a `📷 Image: <attribution> · <license>` line. Image categories are drawn from the **same** `categories.json` pool as text (no separate visual pool).

Image sources are **external, independently-installed plugins** (`commons-image-search`, `brave-image-search`, …) — trivia contains no image-source code. The contract those plugins follow is documented in [`docs/image-search-contract.md`](docs/image-search-contract.md). **Graceful no-tool fallback:** when no `*_image_search__*` tool is installed (or none yields a usable image within the retry budget), the visual path short-circuits to the text-medium path for the same `answersFormat × questionType` — no errors surface, and zero-config deployments are unaffected. Depends on `add-trivia-topical-questions` and `add-trivia-freeform-questions` having shipped.

**Structural per-game overrides.** Beyond the four axes, three structural fields on `TriviaGame` cascade with the same season-wins-over-game ordering:

- `format` (`SeasonFormat`) — per-game slot composition. Cascade: `season.format → game.format → single-question fallback`. When the active season has no `format` but the game does, the game's slots drive the per-fire question count. The format carries an optional `flexible?: boolean` sub-field (NOT a `CascadeAxes` member — it resolves with the format it belongs to, whole-format replace per tier, so a season's format masks a game's `flexible`). When `flexible` is absent/`false` a fire posts exactly `questions.length` questions; when `true`, `slotCount` is a CEILING and a fire posts a PREFIX (`0..questions.length`, in order, count chosen by available material) — posting zero (skipping the day) is valid, and the reveal's existing empty-batch branch (`reveals.length === 0`) silently skips it. `get_ideas` surfaces `flexible: true` in its `format` payload; the generation prompt's per-slot loop stops at the first slot with no usable question.
- `categories` (`string[]`) — per-game category pool. Cascade: `slot.categories → season.categories → game.categories → categories.json`.
- `theme` (`string`) — per-game narrative label surfaced in openers/finales. Cascade: `season.theme → game.theme → (no theme)`.

All three are settable via `upsert_game` (and `format`/`categories` also via `upsert_season` at the season tier) with omit-to-keep / null-to-clear semantics, or admin-edited in `config.json` directly; `list_games` surfaces them in its per-entry response when set.

**Hint axis (optional).** `hint?: { mode: "none" | "button" | "inline"; minDifficulty?: "easy" | "medium" | "hard" }` cascades through `slot → season → game → workspace → { mode: "none" }` with whole-object replace per tier. When effective mode is non-`"none"` (and the rolled difficulty meets `minDifficulty`), `get_ideas` returns `suggestedHintMode`; Claude drafts a ≤140-char hint via the HINT DRAFTING GATE (self-review against bad-vs-good examples) and `save_question` persists it on the record. `"button"` appends a "💡 Get Hint!" button to the answer-button row (clicking posts an ephemeral message in the thread; `clickedBy` tracking is button-mode only and never leaked at reveal). `"inline"` prepends a `💡 _Hint:_ <text>` context block above the answer buttons (visible to everyone). Hints have no scoring impact. Surfaced by `list_games` (per-game + `workspaceDefaults`) when set; admin-edited via `upsert_game` / `upsert_season` / `set_workspace_config`.

**Judge-leniency axis (optional, freeform only).** `judgeLeniency?: "strict" | "strict-with-typos" | "lenient"` cascades `slot → season → game → workspace → "strict-with-typos"` with whole-value replace per tier. It selects which matching-forgiveness fragments the freeform reveal judge composes (orthogonal to the `freeformAnswerShape` block): `"strict"` forgives only case, numeral↔word substitution (`"20"`↔`"Vingt"`), decade-form (`"2020s"`↔`"2020"`), and singular/plural; `"strict-with-typos"` (the default — the prior judge behavior for named-entity answers, now applied across all freeform shapes) adds a 1–2 char typo tolerance plus loose-writing tolerance (spacing, punctuation, accents, homophones like `"lieux"`↔`"lieues"`); `"lenient"` drops the micro-rules for a single intent test — accept any rendering that unmistakably shows the player knew the answer, provided it could not plausibly mean a different valid answer. The universal integrity guards (multi-guess, too-broad, materially-different) apply under every preset. Resolved at `save_question` time and **stamped on the freeform question record** (only a non-default override is stored; absence reads as `"strict-with-typos"`), so a question is judged by the policy in effect when it was posed — immune to later config edits. No `get_ideas` roll and no Claude involvement at generation. Surfaced by `list_games` (per-game + `workspaceDefaults`) and `find_previous_questions` when set; admin-edited via `upsert_game` / `upsert_season` / `set_workspace_config`.

**Choice-bounds axis (optional, choice questions only).** `choices?: { min, max }` (with `2 ≤ min ≤ max ≤ 4`) bounds how many options a `choice` question gets. It is a first-wins `CascadeAxes` member cascading `slot → season → game → workspace → { min: 4, max: 4 }` with whole-object replace per tier — the driving use case is per-slot pacing (e.g. a `game.format.questions` with a 2-option opener escalating to 4-option later slots). It is orthogonal to the `difficulty`/`difficultyRatio` axes (fewer options is its own lever, not a difficulty roll). Two consumers resolve it through `resolveCascade("choices", ctx)`: `get_ideas` rolls `suggestedChoiceCount` uniformly in `[min, max]` (via the choice answer-type handler's `rollGenerationSuggestions`), and `save_question` validates `choices.length` against the resolved bounds (handed to the handler on `SaveValidationContext.resolvedChoiceBounds`, the same way `resolvedJudgeLeniency` is). NOT stamped on the record — the stored `choices` array already encodes the resolved count. Surfaced by `list_games` (per-game `axisOverrides` + `workspaceDefaults`) and `explain_cascade`; admin-edited via `upsert_game` / `upsert_season` (incl. its slot tier) / `set_workspace_config`.

**Choice-emoji-style axis (optional, choice questions only).** `choiceEmojiStyle: "numbers" | "themed"` is a first-wins `CascadeAxes` member cascading `slot → season → game → workspace → "numbers"` with whole-value replace per tier. Purely cosmetic — the vote is always the button's index. `"numbers"` (the default — legacy behavior) prefixes choice vote buttons with 1️⃣ 2️⃣ 3️⃣ 4️⃣. `"themed"` makes the choice handler's `rollGenerationSuggestions` surface `suggestedChoiceEmojiStyle: "themed"` + a `choiceEmojiGuidance` directive in `get_ideas`; Claude then picks ONE unique Unicode emoji per option (each evoking its own option, so the set leaks nothing about the correct answer) and passes them to `save_question` as `choiceEmojis` (parallel to `choices`). The handler validates (count parity, uniqueness, non-ASCII, ≤16 chars; rejected outright when the resolved style is `"numbers"`) and **stamps `choiceEmojis` on the question record**, so the vote buttons (`appendActionsBlock`) and live-roster group labels (`rosterGroupLabel`) render the emojis the question was posed with, immune to later config edits. Omitting `choiceEmojis` under `"themed"` is valid — buttons fall back to numbers. Reveal, scoring, and history are untouched. Surfaced by `list_games` (`axisOverrides` + `workspaceDefaults`, registry-projected) and `explain_cascade`; admin-edited via `upsert_game` / `upsert_season` (incl. its slot tier) / `set_workspace_config`.

**Points axis (optional).** `points?: { max: number; guidance?: string }` (`1 ≤ max ≤ 10`; `guidance` a non-empty trimmed string ≤500 chars) is a first-wins `CascadeAxes` member cascading `seasonSlot → season → gameSlot → game → workspace → { max: 1 }` with whole-object replace per tier. It lets a question be worth more than one leaderboard point. **`guidance` is the switch, not `max`**: `get_ideas` surfaces `maxPoints` + `pointsGuidance` only when the resolved value has BOTH `max > 1` AND a `guidance` string. A bare `{ max: 3 }` is therefore a PERMISSION rather than an instruction — it lets an admin reclass a question up to 3 later via `override_question` while Claude never sees the axis, spends no prompt budget on it, and every question stays worth 1 (byte-for-byte legacy). When surfaced, the `POINTS_GATE` (`prompts/scheduledPrompts.ts`) has Claude pick an integer in `[1, maxPoints]` honoring the guidance and defaulting to 1 (the cap is a ceiling, not a target); `save_question` re-resolves the cascade server-side, rejects out-of-range values and any `points` supplied when the resolved `max` is 1, and **stamps `points` on the record only when > 1** (absence reads as 1), so a question is worth what it was posed at. `post_questions` renders a deterministic "⭐ Worth N points" context block above the answer buttons from the stamped value — part of `postedBlocks`, so live-roster rebuilds preserve it. Scoring is **points-primary**: `computeLeaderboard` takes a REQUIRED `questionPoints` map (a missing arg is a compile error, not a silent 1-point fallback) and pays each correct row `questionPoints.get(id) ?? 1` into new `totalPoints` / `currentSeasonPoints`. The map is joined at aggregation time and never denormalized onto answer rows, so `override_answer` / `replay_question` / invalidation / freeform judging all re-price for free. Ranking, the reveal table's score cells, `roundSummary.perPlayer.points`, `roundMvp`, and `pickSeasonMvp` follow points; `totalCorrect` / `totalAnswered` / `accuracy` keep their exact meanings and `perfectRound` stays completeness-based (so a weighted fire can split `perfectRound` from `roundMvp`). When every question is worth 1, points ≡ correct-count on every surface. Surfaced by `list_games` (`axisOverrides` + `workspaceDefaults`, registry-projected), `explain_cascade`, and `find_previous_questions`; admin-edited via `upsert_game` / `upsert_season` (incl. its slot tier) / `set_workspace_config`.

**`override_question` (admin-only).** A narrow reclass tool for the two stamped values Claude PICKS at generation, which no reprocess can re-derive: `points` and `difficulty` (the 1–10 self-rating). It rounds out the trivia correction family — `override_answer` fixes ONE player's verdict, `settle_question` fixes the answer key everyone was scored against (or invalidates/reopens a question), `remove_cheat` drops a mistaken cheat flag, and `override_question` re-prices or re-rates the question itself. **The allowlist IS the schema**: statement, `answersFormat`, answer-key fields, `season`/`slot`, and `suggestedDifficulty` (which records what the server ROLLED — an audit fact) are structurally unpatchable, so it can never be turned into a question editor. `points` is bounded by the ABSOLUTE 1–10, never by the live cascade `points.max`: that cap governs generation only, and a config edit must never retroactively cap an already-posed question. Each field's pre-override value is captured ONCE into `overriddenFrom` (the `override_answer` `originalVerdict` pattern; an originally-absent value is recorded as its semantic original — `points → 1`, `difficulty → null` — because `JSON.stringify` drops `undefined`) and surfaced by `find_previous_questions`. A `points` change on a posted question rewrites the worth-block inside the stored `postedBlocks` and returns a `refreshHint`; scoring needs no reprocess, since the aggregation join re-prices on the next `compute_answers` / `retrieve_scores`. Works on staged, live, and revealed questions. Registered always-on beside `override_answer` and documented for Claude as Case 4 in `TRIVIA_GAMES_ADMIN_INSTRUCTION`.

**Tag-players knob (optional).** `tagPlayers?: boolean` cascades `game → workspace → true` (game+workspace only — NOT a CascadeAxes member, no season/slot tier; resolved by `resolveTagPlayers`). `true` (default — legacy behavior) names players with real `<@USERID>` Slack mentions on every trivia surface (reveal post, in-thread narrative, finale podium, live answer roster, reveal footer), which pings them. `false` is a workspace-wide no-ping mode: every surface renders players as plain-text `@displayName` instead. Two consumption paths: (1) the Claude-authored reveal post reads the resolved value from the `process_reveal_answers` payload's `tagPlayers` field and follows the MENTION POLICY directive (`scheduledPrompts.ts`); (2) the deterministic blocks read a value **stamped on the question record** at `post_questions` time (`resolveTagPlayers(game, workspace)`), so the live roster (`freeform/roster.ts`) and reveal footer (`revealCards/footer.ts`) honor the policy in effect when the question was posed — absence reads as `true`. The leaderboard `table` always uses bare `displayName` cells, so it is unaffected either way. Surfaced by `list_games` (per-game + `workspaceDefaults`) when set; admin-edited via `upsert_game` / `set_workspace_config`.

### Cron catch-up on boot

The 60s scheduler tick only matches slots in the last minute — a slot passing while the process is down (deploys included) is silently lost. The catch-up layer recovers those: `cron.catchUp.delayMinutes` (fail-fast zod, default 3) after the cron scheduler starts, core dispatches every plugin handler registered via **`sdk.onDelayedBoot(handler)`** — on EVERY boot, sequentially, errors isolated per handler; soft restarts clear and re-collect registrations. Plugins decide in code what to do using two owner-scoped SDK members: **`sdk.missedRuns(specKey)`** → `{ lastExpectedRuns: Date[] }` (canonical slots since `max(lastRunAt ?? createdAt, now − 14d)`, capped at 100; disabled jobs report none) and **`sdk.runCronJobNow(specKey)`** (plain fire-now, NO `asOf` replay — routes through `executeJob` so skipDates, `markJobStarted` double-fire protection, and run history apply). The **trivia** handler (`src/plugins/trivia/catchUp.ts`) walks each enabled game in round chronology `:lock` → `:reveal` → `:question` (each fire awaited; `:prep` never caught up): lock/reveal fire unconditionally when missed (both prompts are self-guarding), while a missed question fires ONLY IF no upcoming regular question fire covers the round AND ≥2h remain before the next lock/reveal deadline — otherwise the day is skipped (never backfilled, one fire max per game per boot) and the owner is DMed (`catchup.quiz_lost`). User-created jobs get no catch-up.

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
- `backups/` — daily state snapshots at `backups/{YYYY-MM-DD}/state/*.json`, written at local midnight by the state-backup scheduler (`src/stateBackup.ts`, config `backup.{enabled,folders,timezone}`). Additive (never pruned); restore by copying a dated `state/` back over `data/state/` (stop the process first). Which folders are captured is config-driven (`backup.folders`, default `["state"]`).

### Trivia plugin: optional pre-staging (`prepCron`)

Each `TriviaGame` may set an OPTIONAL third cron expression, `prepCron`, alongside `questionCron` and `revealCron`. When set, `buildGameSpecs` emits a third channelless cron spec (`<name>:prep`) whose `requiredTools` excludes `post_questions` — two structural defenses against prep accidentally posting. The prep run drives `PREP_QUESTIONS_INSTRUCTIONS` (gen-only fill loop over the staged pool); the question cron switches to `POST_QUESTIONS_INSTRUCTIONS` (staged-pool check + inline-gen fallback + post). When `prepCron` is ABSENT, the question cron runs the legacy `SEND_QUESTIONS_INSTRUCTIONS` — observable behavior is unchanged from before this feature. The bot does NOT derive `prepCron` from `questionCron`; Claude proposes a value conversationally inside `upsert_game` (typically 30 min before questionCron, surfacing midnight-crossing edge cases). All three prompts share `PER_SLOT_GENERATION_PATHS` and `FORMAT_AND_POST_SECTION` building blocks so changes to per-slot generation logic propagate uniformly.

### Trivia cascade registry (single source of truth)

The trivia cascade (`seasonSlot → season → gameSlot → game → workspace → built-in default`) is anchored by ONE definition: the `CascadeAxes` interface (`src/plugins/trivia/core/cascadeAxes.ts`). Every cascade tier type (`SeasonFormatSlot`, `SeasonEntry`, `TriviaGame`, `TriviaConfig`) `extends CascadeAxes`, so all tiers share the same axis key set. `AXIS_REGISTRY` (`domain/resolveCascade.ts`) pairs each axis with a resolver via the `AxisRegistry` mapped type — adding a field to `CascadeAxes` without a registry entry (or vice versa) is a **compile error**. A runtime parity test (`core/configParsers/cascadeParity.test.ts`) asserts the config parser accepts every registry axis, closing the loop config-accepts ⇄ registry ⇄ resolver.

A **member** is any field that resolves through the per-question (slot/season) tiers. The 14 members: 11 uniform first-wins (`answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `hint`, `judgeLeniency`, `choices`, `instructions`, `liveAnswersVisible`, `revealResponses`) + 3 custom (`difficulty` per-field merge, `difficultyRatio` answersFormat-keyed, `additionalInstructions` cumulative concat). Deliberately **excluded**: `allTimeRow` (game+workspace only), `format`/`categories`/`theme` (structural) — these keep their own resolvers and are audited via `list_games`/`list_seasons`.

`resolveCascade(key, ctx, opts?)` is the ONLY resolution path — it returns `{ value, tier, ladder }` (the winning tier is `"merged"` for multi-tier custom merges, `"seasonSlot"`/`"gameSlot"` for the two slot tiers). EVERY consumer calls it: `get_ideas` (the generation axes; the freeform handler resolves `freeformAnswerShape` through it too), `save_question` (`answersFormat`/`questionType`/`contexts`/`judgeLeniency` validation), `post_questions` (`liveAnswersVisible`/`revealResponses`), `process_reveal_answers` (`instructions`/`additionalInstructions`), and the `explain_cascade` audit tool. There are NO legacy per-axis resolvers — `resolveCascade` is the only resolution function importable, enforced by the `cascadeSingleImplementation` guard test. A cross-tool parity test (`tools/cascadeParity.crossTool.test.ts`) asserts `explain_cascade` ≡ `get_ideas` ≡ `save_question` for a game-format slot with no active season. **To add a new cascade axis, the only required touch-points are `CascadeAxes` + `AXIS_REGISTRY`** (plus a per-axis validator if config-settable); the parity test fails until the parser accepts it.

**Game-base / season-override slot model.** `buildCascadeContext(season, game, slotIndex, config)` (`domain/cascadeContext.ts`) is the ONE place that builds the slot tiers, used by every consumer. It splits the slot tier in two: `gameSlot` = `game.format.questions[slotIndex]` (the authoritative per-question BASE, read regardless of season) and `seasonSlot` = the season's override for that index. A game's `format` therefore drives both the question count AND the per-slot config; a season layers sparse overrides on top. The season expresses overrides via `season.slotOverrides` — a count-decoupled keyed map (`{ [slotIndex]: partialSlot }`) merged field-by-field over the game slot — OR via its own `format` (which changes the count); the two are **mutually exclusive** per season (enforced at parse time). No resolver re-derives a slot from `season.format`.

**Game-authoritative writes.** The game tier is the source of truth; a season holds only intentional deltas (omit-to-inherit, null-to-clear). `upsert_game` returns `shadowedBy: { tier: "season" | "slot", slug?, fields }` (`domain/shadowing.ts`) when a written field is masked by a higher tier — Claude surfaces it and offers to clear the season override so the edit falls through. The admin instruction defaults every edit to the game tier; seasons are written only when explicitly scoped.

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
├── plugins/              # Plugin directories ONLY (trivia, idler, casual-talk, …) + CLAUDE.md hard rules
├── plugins-sdk/          # Plugin-facing SDK — top-level files are the ONLY thing plugins may import
│   ├── sdk.ts            # Façade: ClackSdk types + every pure helper (import-time light)
│   ├── testHelpers.ts    # Test-only surface (parseToolResult, createClackSdk, …)
│   ├── toolResults.ts    # Leaf: textResult/errorResult envelopes (core delegates here)
│   ├── zodResult.ts      # Leaf: Result<T> + zodErrorToResult
│   ├── imageSearchResult.ts # Leaf: image-search plugin contract
│   └── internal/         # SDK implementation (factory, cron, messaging, users, memory) — never plugin-importable
├── plugins-core/         # Core-facing plugin loader (registry.ts, state.ts) + pluginBoundary.guard.test.ts
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
