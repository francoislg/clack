## Why

Clack already has every primitive needed to do real work autonomously — worktrees, the Changes Workflow, `auto`-executed actions, GitHub/Asana MCP access, code reading, reviewer skills, review-thread resolution — but nothing drives them when no human is in a thread. Outside work hours those primitives sit idle. The idler plugin turns that idle time into reviewed, mergeable progress: it scans configured sources for work, compares each candidate against the actual codebase, and autonomously triages, implements, self-reviews, and advances pull requests — leaving a human only the final merge and a morning summary to read.

## What Changes

### New `idler` plugin (channelless, off-hours, three cooperating tasks)

Modeled on `casual-talk` (channelless cron, management server, hot-reload config, work-hours awareness). It runs only **outside** Clack's configured active hours and owns three cron specs with distinct cadence and cost:

- **Sync task** (hourly, read-only, no worktree, no change tools). The only task that observes external change, so the only one that re-ranks work. Each run:
  - **Cheap quick-fetch layer (always):** lists open Clack-authored PRs (`find_pull_requests`, filtered by author login / `clack/` branch prefix) and re-polls each tracked unit's references to compare progress.
  - **Incremental discovery layer (rotating):** scans configured Slack channels for unhandled issues (including bot-alert channels like `#sentry-alerts`), polls a tracker for bugs/tasks (Asana, Sentry, …), spread across runs through the night rather than re-scanning everything hourly. Units are keyed by their stable source entity (Sentry issue short-id, Asana gid, PR number) so a re-alerting issue updates its existing unit instead of spawning duplicates.
  - Appends/refreshes self-describing references on each unit, advances per-reference cursors, and **recomputes priority** from kind, fresh-input bumps, and blocked-now sinks.
- **Work task** (every ~15 min, off-hours only, **one unit per tick**). Fetches the top-N units by priority (`list_top_ideas`), picks the highest workable one, and advances it by exactly one step along the kind ladder. "Do nothing this tick" is valid. Serialized to at most one concurrent change by the existing `runningJobs` guard + awaited auto-execute.
- **Summary task** (end of window). Reads the activity log and posts a digest to a configured `reportingChannel`.

### The work-kind ladder (priority order)

1. **Continue** an in-flight Clack PR — read NEW review comments (both human reviewers **and** the Claude Code GitHub bot), address them in a worktree, push, and **resolve the review threads** (`resolve_review_thread`). Worker-mode.
2. **Triage** a candidate against the codebase — query-mode, no worktree. Verdict: actionable, needs-info (comment on source), or already-done (comment with proof).
3. **Implement** an approved candidate — `propose_change` + `submit_response({type:"change", ref, auto:true})`. Worker-mode.
4. **Review** an open PR — `load_skill` a reviewer skill, "find holes," post an approving or change-requesting review; for Clack's own PRs feed the holes back as the unit's next-steps (self-review → continue loop). Query-mode. **Never merges.**
5. **Nothing.**

### `@claude review` trigger loop (one step per tick, best-effort)

After implementing/pushing, the work task can post a `@claude review this` comment to (re)trigger the external Claude Code review bot, then **stop** — a later tick reads the resulting comments via the continue kind. Modeled as "trigger this tick, re-check next tick," not a synchronized handshake.

### Self-describing "ideas" ledger

`data/plugins/idler/ideas.json` — each work unit carries free-text `what` / `whereWeAre` / `nextSteps`, a `source` provenance tag, a sync-computed (Clack-adjustable) `priority`, an `open`/`done` flag, and a **growing list of references** (Asana task → GitHub PR → Slack thread), each self-describing how to **read** its status and how to **comment** back, with a per-reference idempotency `cursor`. No status enum and no sticky focus pointer — stickiness is emergent from priority.

### Triage-against-codebase verdict (with mandatory proof)

Before implementing, Clack compares a candidate to the real code (`search_code` / `get_file_contents` / `git_log`) and either keeps it actionable, **comments asking for missing guidance** (needs-info), or **comments that it is already done with concrete proof** (file:line / commit SHA / PR) and closes it.

### Two instruction layers (kept separate on purpose)

- **Behavior/contract** (shipped, topic-scoped via `addTopicInstruction`): the kind ladder, one-step-per-tick discipline, never-merge, proof-required-for-done, when to ask-for-info vs proceed, how to write a useful comment, the activity-log contract.
- **Fetch/sourcing** (admin-editable `data/plugins/idler/fetch-instructions.md`): which channels, which Asana filters, what "unhandled" means, prioritization hints. Editing this can never corrupt the behavior layer.

### Graceful degradation

If a source's MCP is not installed (no Asana tools, etc.), that source is silently skipped — no errors, zero-config deployments unaffected (mirrors trivia's image-search no-tool fallback). If `@claude` review bot isn't configured, the trigger comment is harmless.

### Safety rails (autonomous, unsupervised overnight)

Repo allowlist (only allowlisted repos may be acted on), per-fire and per-night action caps, never-auto-merge, and the morning summary as the after-the-fact human checkpoint. Failures (worktree execution errors) are recorded on the unit (`whereWeAre`), sink in priority, and are retried on a later night — coordinating with `recover-failed-changes`.

### Core: cold-PR resume (the one genuinely new bot-core capability)

Continuing a PR whose worktree is still warm already works (`propose_change` same-branch → `pool.findByBranch` resume). The gap is a **cold** PR (worktree reclaimed): today's acquire does `git checkout -B <branch> origin/<default>`, which would clobber the PR's commits. Add a worker-pool **resume-from-remote-branch acquire mode** that checks out the existing remote head and runs the idempotent install step, so the PR is re-adopted intact. Sibling of the resume machinery `recover-failed-changes` is already building.

## Capabilities

### New Capabilities
- `idler-plugin`: the channelless off-hours plugin — three cooperating cron tasks (sync/work/summary) with their cadences and off-hours gating, the layered sync (cheap quick-fetch + rotating discovery), the four configurable sources (Slack channels, Asana/tracker, Clack's own PRs, free-form fetch instructions) and their graceful no-MCP degradation, the one-unit-per-tick work loop with its priority-ordered kind ladder, the `@claude review` trigger loop, comment processing (human + Claude Code) with review-thread resolution, the self-review→continue loop, two-layer instructions, activity logging + `reportingChannel` summary, and the safety rails (repo allowlist, action caps, never-auto-merge, failure recording).
- `idler-ideas-ledger`: the self-describing work-unit ledger — entry shape (`open`, `priority`, `source`, free-text `what`/`whereWeAre`/`nextSteps`, growing self-describing `references[]` with per-reference read/comment recipes and idempotency cursors), sync-computed priority recomputed from external signals plus Clack reprioritization, the `list_top_ideas`/reprioritize tool surface, the triage verdict (actionable / needs-info / done-verified-with-proof), per-reference comment idempotency, and the activity log the summary task consumes.

### Modified Capabilities
- `worker-pool`: add a resume-from-remote-branch acquire mode that checks out an existing PR head rather than re-branching from `origin/<default>`, so a cold PR's worktree can be re-adopted without overwriting commits; and the idle-release sweep defers to a worker the idler is actively advancing.
- `changes-workflow`: extend autonomous (button-less) execution so an existing pull request can be continued — addressing review comments, pushing, and resolving threads — mediated through the new acquire mode, not only a fresh branch; and confirm `auto:true` execution from a scheduled context bounds concurrency via the running-job guard.

## Impact

- **New plugin**: `src/plugins/idler/**` — `index.ts`, `config.ts` (+ zod schema), `ledger.ts` (+ zod schema), `priority.ts`, three task prompts (`prompts/sync.ts`, `prompts/work.ts`, `prompts/summary.ts`), behavior topic instructions, management tools (`tools/*.ts`), `tools/listTopIdeas.ts` + `tools/reprioritize.ts`, i18n strings. Registered in `src/plugins/index.ts`.
- **New plugin data**: `data/plugins/idler/config.json`, `data/plugins/idler/ideas.json`, `data/plugins/idler/activity.json` (or per-day log), admin-editable `data/plugins/idler/fetch-instructions.md`.
- **Core (small, additive)**: `src/workers/types.ts` (acquire options), `src/workers/branchSwitch.ts` + `src/workers/reusablePool.ts` (remote-head acquire), `src/workers/disposablePool.ts` (mode stub), `src/changes/workflow.ts` (continue-existing-PR seam), `src/changes/monitor.ts` (idle-release defers to active idler work). Best layered on top of `recover-failed-changes`.
- **MCP/permissions (no new imports)**: relies on the auto-injected GitHub MCP (`contents: read` → `repos`/`git` for `search_code`/`get_file_contents`; `pull_requests: write` → reviews/approve + `issues` for comments) and externally-installed source MCPs (Asana, etc.). The idler reaches them through the cron prompt. `resolve_review_thread` is available in cron (query) context.
- **No breaking changes**: the plugin is off unless registered + enabled + a repo allowlist is set, and is removable by deleting its folder + its `index.ts` line; the core acquire mode is additive (default behavior unchanged, inert without a caller).
