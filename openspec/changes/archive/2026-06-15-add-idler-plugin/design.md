## Context

Clack's autonomous primitives already exist but are human-triggered: the Changes Workflow runs in a worktree and opens PRs, `auto: true` on a `submit_response` action executes a staged change with no button click (`auto-execute-actions`), plugin-managed cron jobs fire as the `system` actor (top of the role hierarchy `["member","dev","admin","owner","system"]`, so every dev+/admin+ tool gate passes), and the auto-injected GitHub MCP exposes code reading (`contents: read` → `repos`/`git` → `search_code`/`get_file_contents`) and review/approve/comments (`pull_requests: write` → `pull_requests`+`issues`). `resolve_review_thread` and `load_skill` are both available in query (cron) context. The `casual-talk` plugin is a working template for a channelless, off-hours, hot-reloading cron plugin with a management server.

What is missing is a driver: nothing decides *what* to work on when no human is present, tracks that work across the systems it spans (Asana → GitHub PR → Slack), or advances it safely overnight. This design adds that driver as the `idler` plugin plus one small core addition (cold-PR resume).

The plugin boundary (`src/plugins/CLAUDE.md`) forbids importing bot core. The idler therefore drives everything **through the cron prompt + existing MCP tools** — it never imports `src/changes/` or `src/workers/`. The single core change is exposed to the idler only as existing-tool behavior, not a new plugin import.

## Goals / Non-Goals

**Goals:**
- Turn off-hours idle time into reviewed, mergeable progress with a human only at the merge and a morning summary.
- Source work from four configurable inputs: Slack channels, Asana (or another tracker), Clack's own open PRs, and a free-form fetch-instruction doc.
- Track each work unit as a single spine that spans multiple external surfaces, self-describing how to read and comment on each.
- Make focus selection dynamic and self-correcting: a unit blocked on a human sinks; when the human replies, it resurfaces automatically the next day.
- Close the self-review loop: Clack reviews its own PRs, finds holes, and fixes them on a later tick.
- Keep the plugin boundary intact — one new core seam, additive and off-by-default.

**Non-Goals:**
- Auto-merging. Clack may triage, implement, continue, self-review, and *approve*, but the merge button stays human (at least v1).
- Parallel work. At most one change executes at a time (serialized by `runningJobs` + awaited auto-execute).
- A rigid state machine. State is minimal (`open`/`done` + a `priority` number + a `source` tag); everything else is free text Clack reads with judgment.
- Token-usage accounting (explicitly deferred — action caps are the only spend lever in v1).
- Reliability guarantees on the two-actor `@claude review` handoff — modeled as "trigger this tick, re-check next tick."

## Decisions

### Three cooperating tasks, not one monolith
Split into **sync** (hourly, read-only, no worktree), **work** (~15 min, off-hours, one unit/tick), and **summary** (end of window). Rationale: the cheap read-only backlog refresh runs often without burning a worker; only the work task spends a worktree; the summary reads an append log. *Alternative considered:* one cron doing discover-and-act each tick — rejected because discovery/polling and code-changing have wildly different cost and cadence.

### Layered, incremental sync
Sync does a **cheap quick-fetch every run** (list open Clack PRs by author/branch-prefix, re-poll tracked references via their `howToRead`) and **rotates deeper discovery** (channel scans, Asana polls) across runs through the night instead of re-scanning everything hourly. Rationale: the user wants progress tracked "once an hour, incrementally through the day" — quick status comparison is cheap and frequent; expensive discovery is spread.

### Self-describing ledger, minimal state
`data/plugins/idler/ideas.json` holds work units. Each carries `open` (the only status), `priority`, a `source` provenance tag, free-text `what`/`whereWeAre`/`nextSteps`, and a **growing `references[]`** — one entry per surface (Asana task, GitHub PR, Slack thread), each self-describing `howToRead` and `howToComment` plus an idempotency `cursor`. Clack, not code, reads the ledger and decides; rigid enums add machinery without adding control flow. A work unit migrates across surfaces over its life, so a single retrieval recipe is wrong — the entry accumulates references. *Alternative considered:* a multi-state enum + sticky `activeId` pointer — rejected; stickiness is emergent from priority.

### Sync owns a recomputed priority — the loop-closer
Every sync run re-polls each open unit's references and recomputes `priority` from: kind weight (continue > triage > implement > review), fresh-input bumps (a human reply, a new PR comment past the cursor), and blocked-now sinks (waiting on a human with no reply). Clack may override via a reprioritize tool. Rationale: sync is the only task observing external change, so it must be the one that re-ranks — this is exactly what makes "overnight the Asana question sinks; next morning a reply resurfaces it" work with no special-casing. The work task fetches the top-N (`list_top_ideas`) and advances the highest workable one, or does nothing.

### Query-mode vs worker-mode kinds
Triage and review are **query-mode** (read code, post comments/reviews — no worktree, cheap). Implement and continue are **worker-mode** (worktree, push). This split keeps most ticks cheap and bounds worktree usage (which is also the action-cap target).

### Autonomous execution via existing `auto: true` + system actor
The work task drives code changes by instructing Claude (in the cron prompt) to call `propose_change` then `submit_response({ type: "change", ref, auto: true })`. No new trigger mechanism; no button. The cron fires as the `system` actor, which passes every tool gate; the only remaining gate is `changesWorkflow.enabled`. Auto-execute awaits the full workflow, so the `runningJobs` guard skips the next tick until it finishes — natural serialization to one change at a time.

### One new core seam: cold-PR resume
Continuing a warm PR already works (`propose_change` same-branch → `pool.findByBranch` resume). The gap is a **cold** PR (worktree reclaimed): today's acquire does `git checkout -B <branch> origin/<default>`, which would clobber the PR's commits. Add a **resume-from-remote-branch acquire mode** that checks out the existing remote head (`git fetch origin <branch>` → `git checkout -B <branch> origin/<branch>`) and runs the idempotent install step, so the PR is re-adopted intact. Sibling of `recover-failed-changes`'s resume machinery. *Alternative considered:* a brand-new `continue_pull_request` tool + `continuePrWorkflow` entry — rejected as redundant; extending the acquire decision tree reuses the whole workflow.

### Comment processing and the @claude loop
The continue kind reads NEW PR comments since the reference cursor — from **both** human reviewers and the Claude Code GitHub bot — addresses them in the worktree, pushes, advances the cursor, and **resolves the review threads** (`resolve_review_thread`). To (re)trigger external review it posts `@claude review this` and stops; the next tick picks the resulting comments back up. One step per tick keeps it simple and robust to the unsynchronized two-actor handoff.

### Self-review → continue loop
Reviewing Clack's *own* open PR (review kind) finds holes; instead of (or in addition to) a change-requesting review, Clack writes the holes into the unit's `nextSteps`. A later continue tick reads them and fixes. Reviewing *human* PRs is the same kind pointed outward — post a review, optionally approve, never merge.

### Two instruction layers
Shipped **behavior/contract** instructions (topic-scoped, pre-attached via `attachedTopics`): the kind ladder, one-step-per-tick discipline, never-merge, proof-required-for-done, ask-vs-proceed judgment, comment-writing guidance, activity-log contract. Admin-editable **fetch/sourcing** instructions (`data/plugins/idler/fetch-instructions.md`): which channels, Asana filters, what "unhandled" means, prioritization hints. Editing *what to fetch* must never corrupt *how to behave safely*.

### Graceful degradation
Each source is optional. If its MCP tools are absent (no Asana server installed), that source is skipped silently — no error, zero-config deployments unaffected (mirrors trivia's image-search no-tool fallback). The fetch-instructions teach Clack to write the correct `howToRead`/`howToComment` recipe per source, so adding a new tracker needs no idler code change.

## Detailed flows

```
SYNC (hourly, read-only)
  quick-fetch:   find_pull_requests(state:open, author≈clack) → refresh PR references
  poll:          for each open unit → run every reference.howToRead, advance cursors
  discover:      rotating scan of channels / Asana per fetch-instructions → append units
  rank:          recompute priority(open units) from kind + fresh-input + blocked
  write:         ideas.json (NOT the in-flight unit's nextSteps — work owns that)

WORK (~15 min, off-hours, one unit)
  list_top_ideas(limit=5) → pick highest workable by kind ladder:
    CONTINUE → acquire (warm via findByBranch, else cold-resume) → address NEW
               comments (human + Claude Code) → push → resolve_review_thread → cursor++
    TRIAGE   → search_code/get_file_contents/git_log vs candidate →
                 actionable → keep open, raise priority
                 needs-info → comment on source (howToComment) → record cursor
                 done       → comment WITH proof (file:line/commit/PR) → open=false
    IMPLEMENT→ propose_change + submit_response{type:change,ref,auto:true}  [allowlist+caps]
    REVIEW   → load_skill(reviewer) → find holes →
                 own PR  → write holes into nextSteps (feeds CONTINUE)
                 human PR→ post review, optionally APPROVE  (never merge)
    (optional) post "@claude review this" then stop
    nothing  → terminate
  append every action to activity.json ; enforce per-fire / per-night caps

SUMMARY (end of window)
  read activity.json → post digest to reportingChannel:
    PRs opened · comments addressed · reviews/approvals · units parked + why
    · ready-to-merge list · failures
```

## Risks / Trade-offs

- **Unsupervised overnight commits to real repos** → repo allowlist, per-fire/per-night action caps, never-auto-merge, morning summary as the human checkpoint. Full-auto is opt-in via `changesWorkflow.enabled` + plugin enabled flag + a non-empty allowlist.
- **Comment spam** (re-asking Asana hourly, reprocessing PR comments) → per-reference `cursor` + `whereWeAre`; sync re-triages/re-comments only when the source changed past the cursor.
- **Ledger write races** (sync and work are separate cron jobs) → the work task is the sole authority on the unit it is actively advancing; sync refreshes priority/`whereWeAre` for all *other* units and never overwrites the in-flight unit's `nextSteps`. Each job is itself serialized by `runningJobs`.
- **Cold-PR clobber** → the new acquire mode is the mitigation; until it ships, the work task only continues warm PRs (`findByBranch` non-null) and leaves cold ones for a human.
- **Idle-release races an idler-touched PR** → `monitor.ts`'s idle sweep could detach a worker the idler is about to resume; rule: an idler action resets the worker's idle clock, and the work task checks claim state before acting.
- **Worktree execution failure** → recorded on the unit (`whereWeAre`), priority sinks, retried a later night; routes through `recover-failed-changes` recovery rather than bricking.
- **Missing source MCP** → graceful skip, no error.
- **Stale priority between sync runs** → the work task re-reads the top unit's references at pickup before committing to a step, so a just-changed unit isn't acted on with hour-old context.
- **`@claude` bot absent or slow** → trigger comment is harmless; the unit simply waits at lowered priority until comments appear.

## Migration Plan

- Additive and gated: the plugin is off unless registered + enabled + a repo allowlist is set; the core acquire mode is a new branch in the decision tree, default behavior unchanged.
- Recommended ordering: land `recover-failed-changes` first, then the cold-PR acquire mode on top of its resume machinery, then the plugin (core → ledger → sync → work → summary).
- Rollback: remove the `idler` line from `src/plugins/index.ts` and delete `src/plugins/idler/`; the core acquire mode is inert without a caller.

## Open Questions

- Should "Clack work hours" be a shared core concept the idler reads, or does the idler keep its own `activeHours` (= the off-window)? Leaning idler-local for v1.
- Auto-merge-on-green as a later opt-in flag — out of scope now, but the `done`/summary shape should not preclude it.
- Whether reviewing Clack's *own* PRs (self-review) and *human* PRs should be separately gateable, or one "review open PRs" knob.
- How aggressively to rotate discovery (which sources per run) — start round-robin, tune from the summary.
