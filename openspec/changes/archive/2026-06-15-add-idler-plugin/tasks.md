## 1. Core: cold-PR resume acquire mode (layer on top of `recover-failed-changes`)

- [x] 1.1 Extend `WorkerPool.acquire` in `src/workers/types.ts` with an acquire-mode option distinguishing fresh-branch (default) from resume-from-remote-branch
- [x] 1.2 Implement remote-head checkout in `src/workers/branchSwitch.ts`: `git fetch origin <branch>` then `git checkout -B <branch> origin/<branch>` (NOT `origin/<default>`), preserving commits, followed by the idempotent install step
- [x] 1.3 Wire the new mode through the `src/workers/reusablePool.ts` acquire decision tree — warm-branch resume (`findByBranch`) unchanged, default fresh-branch unchanged, new mode only when explicitly requested for an existing PR
- [x] 1.4 Stub/handle the new mode in `src/workers/disposablePool.ts` so both pools satisfy the interface
- [x] 1.5 Add a continue-existing-PR seam in `src/changes/workflow.ts`: resolve PR → head branch/repo, acquire via the new mode, build resume context, reuse existing worker-mode execution/push/PR-update path; pass outstanding review comments as context; never merge
- [x] 1.6 Resolve addressed review threads on continuation (reuse `resolve_review_thread` path)
- [x] 1.7 Coordinate with `src/changes/monitor.ts`: idle-release sweep must NOT detach a worker whose branch the idler just advanced — reset the idle clock on an idler action
- [x] 1.8 Unit tests: remote-head acquire preserves commits; warm/fresh paths unchanged; continuation incorporates comments + resolves threads; idle-release defers to active work

## 2. Plugin scaffold + config

- [x] 2.0 Hard boundary (enforce while coding every file in this group and beyond): no file under `src/plugins/idler/**` imports from `src/changes/`, `src/workers/`, `src/config.ts`, `src/logger.ts`, or `src/slack/...` — reach everything through the SDK and existing MCP tools (per `src/plugins/CLAUDE.md`)
- [x] 2.1 Create `src/plugins/idler/index.ts` modeled on `casual-talk`: cron-capability guard (`sdk.error` + return if absent), `registerDictionary`, behavior topic instructions, on-demand management server, reconcile + `watchFile` hot-reload
- [x] 2.2 Define `IdlerConfig` zod schema + loader (`src/plugins/idler/config.ts`): `enabled`, active (work) hours + timezone, `repoAllowlist[]`, `reportingChannel`, `maxActionsPerFire`, `maxActionsPerNight`, source toggles (channels[], tracker on/off, ownPrs on/off). Fail-fast for boot-shaped config, graceful for state.
- [x] 2.3 Build the off-hours cron expressions: sync (hourly), work (~15 min), summary (end of window) — all gated to fire only OUTSIDE active hours (inverse of `casual-talk`'s in-hours window); reconcile as channelless specs
- [x] 2.4 Register the plugin in `src/plugins/index.ts`
- [x] 2.5 Add `en`/`fr` i18n strings for direct-to-Slack idler text (summary digest, any management tool confirmations) via `sdk.registerDictionary`
- [x] 2.6 Unit tests: config defaults, allowlist/caps parsing, disabled / empty-allowlist short-circuit, off-hours gating, hot-reload re-reconcile

## 3. Ideas ledger

- [x] 3.1 Define the ledger zod schema (`src/plugins/idler/ledger.ts`) — graceful permissive reader: `open`, `priority`, `source`, stable `key` (source entity id — Sentry short-id / Asana gid / PR number), free-text `what`/`whereWeAre`/`nextSteps`, growing `references[]` each with `kind`, ids, `howToRead`, `howToComment`, `cursor`
- [x] 3.1a Implement source-keyed dedup on upsert: discovering an existing entity updates its unit (cursor/`whereWeAre`) rather than creating a duplicate; unit test repeated-Sentry-alert → one unit
- [x] 3.2 Implement ledger read/write via `sdk.readFile`/`writeFile`; malformed/missing file → log + default empty ledger (never wipe)
- [x] 3.2b Define ledger concurrency rules: the work task is the sole writer of the unit it is actively advancing (`whereWeAre`/`nextSteps`/`references`); sync refreshes only OTHER open units; the work task re-reads its selected unit's references before committing to a step. Document + test that sync skips the in-flight unit.
- [x] 3.3 Implement priority recomputation (`src/plugins/idler/priority.ts`): kind weight (continue > triage > implement > review) + fresh-input bump (reply / new comment past cursor) + blocked-now sink; pure + unit-testable
- [x] 3.4 Register `list_top_ideas({ limit })` tool (top-N by priority, default 5) and a `reprioritize` tool. Gating: both tools admin+ (the work/sync cron fires as `system`, which passes admin+); reprioritize is admin-authority by nature
- [x] 3.5 Define the activity log shape + append helper (`src/plugins/idler/activity.ts`): PR opened, comments addressed, review/approval, parked + reason, failure. Retention: append-only per off-hours window; the summary task reads then rolls/clears it for the next window (define create/clear timing so summary never reads an empty/stale file)
- [x] 3.6 Unit tests: schema defaults/malformed fallback, source provenance preserved, priority ordering, fresh-input bump, blocked sink, top-N bounding, reprioritize override, done units excluded, activity append, source-keyed dedup (repeated alert → one unit), re-activated done unit re-opens, sync skips the in-flight unit

## 4. Sync task

- [x] 4.1 Build the sync cron spec (hourly, channelless, off-hours, read-only — NO change-proposing tools in `requiredTools`; include `find_pull_requests`, `find_changes`, channel/code read tools, `list_top_ideas`, reprioritize)
- [x] 4.2 Author the sync prompt — quick-fetch layer: list open Clack PRs (filter by author login / `clack/` branch prefix via `find_pull_requests`), refresh each tracked reference via `howToRead`, advance cursors
- [x] 4.3 Sync prompt — incremental discovery layer: round-robin across the four sources (Slack channels incl. bot-alert channels, tracker MCP, own PRs, fetch-instruction rules), each source covered at least once per off-hours window; append new units with self-describing references keyed by stable source entity id; for EVERY appended reference populate the complete `howToRead` AND `howToComment` recipe at discovery time (so triage/continue can act without re-deriving); respect graceful no-MCP skip
- [x] 4.3a Sync prompt — bot-alert channel handling: for `#sentry-alerts`-style channels, extract the issue title + short-id/URL (drilling into the permalink via `fetch_slack_message` when the overview is insufficient, since `fetch_channel_messages` strips attachment blocks), key the unit by Sentry issue id, and set `howToRead` to a Sentry MCP if installed else the Slack message + linked URL
- [x] 4.4 Sync prompt — recompute priority for all open units; do NOT overwrite the in-flight unit's `nextSteps` (work task is its sole authority)
- [x] 4.5 Wire graceful degradation: a configured source whose MCP tools are absent is skipped silently
- [x] 4.6 Unit tests: spec shape (no change tools, no worktree), off-hours gate, in-flight-unit nextSteps not clobbered, round-robin discovery rotation, Sentry alert extraction + issue-keyed dedup, recipe (`howToRead`/`howToComment`) populated at discovery

## 5. Work task

- [x] 5.1 Build the work cron spec (~15 min, channelless, off-hours; `requiredTools` include `propose_change`, `resolve_review_thread`, `load_skill`, `find_pull_requests`, code-read tools, ledger tools). Confirm these dev+-gated tools resolve for the `system` cron actor (top of role hierarchy). NOTE: this group depends on task group 1 (cold-PR resume acquire) — defer 5.5's cold path until 1.3 lands.
- [x] 5.2 Author the work prompt skeleton: `list_top_ideas(5)` → pick highest workable by the kind ladder → advance ONE step → write back `whereWeAre`/`nextSteps`/cursor → append to activity log → enforce per-fire/per-night caps → allow "do nothing"
- [x] 5.3 TRIAGE branch (query-mode): compare candidate to codebase (`search_code`/`get_file_contents`/`git_log`) → actionable (keep open, raise priority) / needs-info (comment on source via `howToComment`, record cursor) / already-done (comment WITH proof: file:line / commit / PR, then `open=false`)
- [x] 5.4 IMPLEMENT branch (worker-mode): `propose_change` + `submit_response({type:"change", ref, auto:true})`; gate to allowlisted repos + caps; append PR reference to the unit on success
- [x] 5.5 CONTINUE branch (worker-mode): read NEW PR comments since cursor (human + Claude Code bot), continue via warm resume or cold-resume (task group 1, requesting resume-from-remote-branch explicitly), push, `resolve_review_thread`, advance cursor; one step per tick. On acquire failure (PoolExhausted / missing remote branch / dirty-quarantine): record the blocker on `whereWeAre`, leave the unit open for retry, do NOT clobber the branch
- [x] 5.6 `@claude review` trigger: after a push, optionally post `@claude review this` and STOP — defer reading results to a later continue tick; harmless if no external bot
- [x] 5.7 REVIEW branch (query-mode): discover available reviewer skills via `list_skill_pack_skills`, `load_skill` the most fitting one (prefer a focused reviewer such as `review-general`/`code-review`; behavior instructions name the preference order) → find holes → own PR: write holes into `nextSteps` (self-review → continue); human PR: post review, optionally APPROVE; NEVER merge
- [x] 5.8 Failure handling: on worktree execution failure, record on `whereWeAre`, sink priority, keep unit open for later retry (coordinate with `recover-failed-changes`)
- [x] 5.9 Unit tests: kind-ladder selection + preemption, do-nothing path, triage three verdicts, proof-required for done, allowlist enforcement, per-fire/per-night cap enforcement, never-merge invariant, cursor idempotency (no duplicate comments)

## 6. Summary task

- [x] 6.1 Build the summary cron spec (end of window, channelless, posts to `reportingChannel`)
- [x] 6.2 Author the summary prompt: read the activity log → post a digest (PRs opened, comments addressed, reviews/approvals posted, units parked + why, ready-to-merge list, failures)
- [x] 6.3 Localize the digest via `sdk.t()` (direct-to-Slack path)
- [x] 6.4 Unit tests: digest shaping from a sample activity log (covers each entry kind)

## 7. Instructions (two layers)

- [x] 7.1 Ship behavior/contract topic instructions via `addTopicInstruction` (+ `attachedTopics` on each spec): the kind ladder, one-step-per-tick discipline, never-merge, proof-required-for-done, ask-vs-proceed judgment, comment-writing guidance, the activity-log contract
- [x] 7.2 Seed an admin-editable default `data/plugins/idler/fetch-instructions.md` (which channels, tracker filters, what "unhandled" means, prioritization hints, per-source read/comment recipe guidance). Injection mechanism: the sync/work reconcile reads the file and embeds its content as a prompt section baked into the cron spec at reconcile time (like `casual-talk`); a `watchFile` re-reconciles on edit (hot-reload, no restart)
- [x] 7.2a Include a worked Sentry example in the fetch-instructions default: how to parse a `#sentry-alerts` message (issue title + short-id/URL), dedup by Sentry issue id, build the `howToRead`/`howToComment` recipe (Sentry MCP if present else Slack+URL), and how to link a resulting PR back to the issue
- [x] 7.3 Verify editing fetch-instructions does not alter the shipped behavior instructions (parity/structure test)

## 8. Management tools (admin, on-demand server)

- [x] 8.1 Register an on-demand `idler:management` server (admin-gated, `autoload:false`) with a management instruction
- [x] 8.2 Tools: enable/disable, set active hours, set `reportingChannel`, add/remove allowlisted repo, set action caps, add/remove discovery channel, toggle a source, view/clear ideas, reprioritize
- [x] 8.3 Decide per-tool hot-reload vs soft-restart per `src/plugins/CLAUDE.md` (runtime-only fields hot-reload; tool-gating/registration needs restart)
- [x] 8.4 Tool-mapping labels for Slack task cards; unit tests for each mutation tool

## 9. Verification

- [x] 9.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on all new files
- [x] 9.2 Full `npm test` green (incl. i18n parity for new strings)
- [x] 9.3 `openspec validate add-idler-plugin --strict`
- [x] 9.4 Plugin-boundary check: no imports from `src/changes/`, `src/workers/`, `src/config.ts`, `src/slack/...` in `src/plugins/idler/**`
- [ ] 9.5 Manual dry-run: enable behind allowlist on a throwaway repo; confirm off-hours gating, layered sync, one-unit-per-tick, triage verdicts (incl. needs-info + done-with-proof comments), continue + thread resolution, never-merge, graceful no-MCP skip, and summary delivery
- [x] 9.6 Update `graphify-out/` (run `graphify update .`) and reflect the new plugin in `CLAUDE.md` plugin notes if warranted
