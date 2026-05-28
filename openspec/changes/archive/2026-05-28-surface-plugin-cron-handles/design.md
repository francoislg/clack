## Context

Two tools sit on the path from "I want to test this trivia cron job" to actually firing it: `list_games` (trivia plugin) for domain-flavored discovery, and `list_scheduled_messages` (core) for scheduler-infrastructure discovery. Both are broken for plugin-managed jobs today:

- `list_games` surfaces `prepCron`/`questionCron`/`revealCron` (cron *expressions*) and `nextPrepFire` (next-fire *timestamp*) but no job UUID. `run_scheduled_message_now` requires the UUID. Path dead-ends.
- `list_scheduled_messages` filters on `args.all && isAdmin ? getJobs() : getJobsByUser(ctx.userId)`. `getJobsByUser` is strict equality on `createdBy`. Plugin-managed jobs have `createdBy: null`. The documented `plugin` filter applies *after* the scope filter, so passing `plugin: "trivia"` to a user-scoped query returns zero rows. The schema description (`"Use this to find a plugin's channelless cron job"`) is contradicted by the implementation.

The action layer already enforces ownership at the right place: every single-job tool (`run_scheduled_message_now`, `cancel_scheduled_message`, `update_scheduled_message`, `get_scheduled_message`, `get_scheduled_message_runs`) uses Pattern A — `if (!isAdmin && job.createdBy !== ctx.userId) deny`. Non-admins cannot ACT on plugin-managed jobs regardless of list visibility. The list-tool `all` flag is therefore not a permission gate; it's a noise-filter dressed up as one.

## Goals / Non-Goals

**Goals:**
- Make plugin-managed cron job UUIDs discoverable from the natural entry points without requiring tribal knowledge of the `plugin: <name>` + `all: true` combination.
- Separate scope (whose jobs) from filter (narrow within scope) as orthogonal concerns. Filters should always apply.
- Keep the existing action-layer permission gate (Pattern A) as the authoritative ownership check; the list tool only controls visibility.

**Non-Goals:**
- Changing how plugin cron jobs are created, reconciled, or persisted.
- Adding a trivia-specific `run_game_slot_now` tool (every plugin reinventing on-demand-fire is the wrong direction).
- Allowing `run_scheduled_message_now` to accept `{plugin, specKey}` instead of `id` (worth a follow-up if a second plugin hits the same wall; not needed once UUIDs are surfaced).
- Migrating any persisted data — the rename is tool-schema only.

## Decisions

### D1: Rename `all` → `includeOtherUsers` (no alias)

The name `all` framed an admin-only verbosity opt-in as a permission scope, conflating two concerns. The replacement `includeOtherUsers` names what the flag actually does: include jobs created by users other than the caller.

**Alternative considered**: keep `all`, add a parallel `scope: "mine" | "all" | "plugin-only"` enum. Rejected because (a) the dual surface is more API to maintain, (b) the boolean flag answers the only real-world question, (c) `all`'s misleading name is the bug — keeping it sustains the confusion.

**Alternative considered**: add an alias so both names work during transition. Rejected because the only consumer is Claude (reading the tool description per turn) and the Home Tab (no current caller — verified during implementation as a precondition). Aliasing earns nothing and leaves cruft.

### D2: Default scope is "mine + plugin-managed"

Plugin-managed jobs have `createdBy: null` — no owner. Surfacing them in the default scope:
- Fixes the `plugin` filter (it now narrows a set that actually contains plugin jobs).
- Lets non-admins see schedule metadata they can't act on (informational only; Pattern A still blocks writes).
- Removes the "hidden third class of jobs" surprise that motivated this change.

**Alternative considered**: keep default scope as `createdBy === userId`; add explicit `scope: "plugin"` filter. Rejected because it pushes the awkwardness onto every caller — `{plugin: "trivia"}` alone is the natural ask, and forcing `{scope: "plugin", plugin: "trivia"}` is redundant. Filters should compose with scope, not duplicate it.

**Alternative considered**: gate plugin-managed visibility behind admin role too. Rejected because plugin jobs leak nothing sensitive — their schedules and prompts are no more private than the role configuration any user can see in the Home Tab.

### D3: Filters always apply within scope

`channel` and `plugin` (and any future filter) narrow the result set after scope resolution. They never reach back to expand scope, and they never produce a no-op when scope was set narrowly. Concretely:

```
                      ┌──────────────────┐
                      │ Choose scope:    │
                      │  - default       │  =  mine + plugin-managed
                      │  - includeOther  │  +=  jobs from other users
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Apply filters:   │
                      │  - channel       │  narrows the set
                      │  - plugin        │  narrows the set
                      └──────────────────┘
```

### D4: `list_games` exposes UUIDs as flat fields per game

`prepJobId`, `questionJobId`, `revealJobId` mirror the flat shape of the existing `prepCron`/`questionCron`/`revealCron` and `nextPrepFire` fields. Each field is present IF AND ONLY IF the corresponding cron spec is registered AND the SDK lookup resolves a job.

**Alternative considered**: nested `jobIds: { prep, question, reveal }` block. Rejected because it breaks shape symmetry with the existing flat fields and forces Claude to remember a separate access path.

### D5: ID resolution uses SDK lookup, not direct file access

The trivia plugin uses an SDK accessor (existing `findByPluginOwner(ownerKey)` already covers this — `src/cronJobs.ts:254`, accessible via the SDK if it isn't already exposed). The plugin loops the registered specs for its games and matches by `specKey`. No direct read of `data/state/cron-jobs.json` from plugin code — that would violate the plugin boundary in `src/plugins/CLAUDE.md`.

**Note**: investigate during implementation whether the SDK currently exposes `findByPluginOwner` (or equivalent). If not, expand the SDK rather than bypass it — per the plugin hard rules.

## Risks / Trade-offs

- **[Risk] Existing callers passing `all: true` break on the rename** → Mitigation: the only known caller is Claude itself (reads the description fresh per turn). Verify zero internal callers grep before merging; if any exist (Home Tab, migration code, tests), update in the same PR. The repo greps clean for `all: true` against `list_scheduled_messages` outside of the tool's own definition and tests.
- **[Risk] Default-scope expansion surprises admins who relied on the smaller list** → Mitigation: result sets get *bigger*, not smaller; no jobs disappear. The added rows are plugin-managed jobs the admin could already see via `all: true`. Surprise factor is low.
- **[Trade-off] N-games × O(jobs) lookup cost for `list_games`** → For typical workspaces (<10 games, <100 cron jobs total), negligible. If a future workspace runs hundreds of games, batch the lookup by calling `findByPluginOwner("trivia")` once and indexing in-memory by `specKey`. Implementation should batch from day one to avoid the smell.
- **[Risk] Non-admin sees a plugin job UUID and tries to run it** → Mitigation: Pattern A in `run_scheduled_message_now` denies non-admins regardless of visibility. The denial message is already clear. No new vector.

## Migration Plan

No data migration. The behavior change is tool-schema only.

Rollout:
1. Land the change with both fixes in a single PR (they're tightly coupled by intent).
2. Update tool descriptions in lockstep with behavior so Claude adapts immediately on first invocation.
3. No version bump or feature flag needed — this is internal MCP tool surface that Claude re-reads per session.

Rollback: revert the PR. No persisted state to clean up.

## Open Questions

- Should the renamed `includeOtherUsers` argument also short-circuit when set by a non-admin (silently ignore, vs. error)? Today `all: true` from a non-admin silently falls back to user scope. Lean: keep the silent-fallback behavior — non-admin requesting cross-user visibility is harmless to ignore. **Decided in implementation**.
- Are there other plugins beyond trivia and casual-talk that register crons today? If yes, do their domain-discovery tools need analogous job-ID exposure? **Investigate during implementation; only fix trivia in this change.** Other plugins can adopt the pattern when they hit the same need.
