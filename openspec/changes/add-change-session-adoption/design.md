# Design — Change Session Adoption

## Context

A change session's durable state is **branch-keyed** (`data/worktree-sessions/<branch>/`), while its conversation binding is a thin in-memory layer: `activeChanges` + `sessionRefs` maps keyed by sessionId (= channel-threadTs-user) in `src/changes/activeState.ts`, plus the reusable worker's `claimedBy` sessionId. `activeChange.sdkSessionId` is what lets same-thread follow-ups resume the worker Claude's SDK conversation.

Continuing a PR from a different conversation today goes through `propose_change` + `continue_existing_pr` → a brand-new change session on the same branch, which:

1. collides with the original session's worker claim (`AlreadyInFlight`, `reusablePool.ts:154`) for up to `idleReleaseHours` (default 24h), surfacing as an opaque `Failed to create workspace`;
2. even if forced through, would start a cold worker run (no `sdkSessionId`) and leave two sessions referencing one branch.

The timer-driven idle sweep (`monitor.ts:runIdleSweep`) already knows how to classify claim liveness (`activeChange.handle`, actively-executing statuses) and detach safely (`detachIfClean`, dirty → quarantine).

Two adjacent defects ride along: `propose_change`'s existing-work probe (`getExistingWorktree`) is a disposable-mode path lookup that never matches reusable `worker-N/` folders; and the detached-follow-up re-acquire (`workflow.ts:711`) acquires without `resumeRemoteBranch`, so a cold re-acquire rebuilds a PR branch from `origin/<default>` (`branchSwitch.ts:60-63`) — a latent commit-clobbering gap.

## Goals / Non-Goals

**Goals:**

- "Continue this PR" from any conversation the user owns re-homes the live change session there — same status, `prUrl`, `sdkSessionId`, follow-up ladder; the worker Claude resumes with context.
- Exactly one session references a branch at any time (no ping-pong).
- A live run still refuses continuation elsewhere, pointing at the running conversation.
- An orphaned claim (session gone) never blocks the branch.
- `propose_change` reports existing work + claim state in both pool modes, before any button click.
- Zero behavior change for same-conversation follow-ups and for disposable mode's claim path.

**Non-Goals:**

- Changing the hold-after-`pr_created` model, `idleReleaseHours`, or the idle sweep.
- Multi-conversation shared ownership of one change (adoption *moves*, never *forks*).
- Cross-user adoption below admin (dev A cannot silently lift dev B's change into their DM).
- A new MCP tool — the existing `propose_change` + `continue_existing_pr` intent stays the single continuation entry point.
- Notifying the old thread proactively on adoption (open question; buttons answer reactively via tombstone).

## Decisions

### D1 — Adoption re-homes the existing session instead of creating a new one

When the continuation workflow starts for branch `B` and an `activeChange` for `B` exists under another sessionId, the workflow **adopts** rather than creating a fresh `ActiveChangeState`:

```
DM: propose_change(continue_existing_pr) → button click → startChangeWorkflow
        │
   findActiveChangeByBranch(repo, B) ──none──▶ existing fresh-continuation path
        │ found under oldSessionId              (+ orphan-claim fallback, D5)
        ▼
   liveness check (D3) ──live──▶ refusal naming the claiming conversation
        │ cold
        ▼
   permission check (D4) ──denied──▶ refusal naming the owner
        │ ok
        ▼
   adoptActiveChange(oldSessionId → newSessionId, newRef)   [activeState.ts]
   reassignClaim(worker, newSessionId)                      [pool, if a worker holds B]
   tombstone(oldSessionId → newRef)                         [activeState.ts]
        ▼
   continuation executes as a FOLLOW-UP on the adopted session
   (resumes sdkSessionId; worktree re-acquired via detached path if cold)
```

`adoptActiveChange` is a move: `activeChanges` + `sessionRefs` entries are deleted under the old key and set under the new one; the next persistence write stamps the new channel/threadTs into the branch-keyed session folder, so the re-homing **survives restarts** via the existing `restore.ts` path with no new persistence format.

A lookup `findActiveChangeByBranch(repo, branch)` is added to `activeState.ts` (linear scan of the map, same style as `getActiveChangeForUser`).

*Alternative considered:* claim **takeover** — detach the old session's worker, start a fresh change session (the previous revision of this design). Rejected as primary: loses `sdkSessionId` context, produces two live sessions per branch (ping-pong risk), and rebuilds state (`prUrl`, verification counters) the original session already holds. Takeover survives only as the orphan fallback (D5).

### D2 — The adopted continuation runs as a follow-up, not a fresh execution

After re-homing, the request routes through the follow-up/update execution path (the same one `request_update` uses), NOT a fresh `executeChange` prompt: the adopted `sdkSessionId` is resumed, so the worker continues the conversation it already had. If the adopted change has no worktree (idle-released cold), the existing detached-follow-up re-acquire provides one — fixed by D6 to preserve PR commits.

Verified feasible with no architectural surgery: `executeChange` already accepts `sdkSessionId` and forwards it as `resumeSessionId` to the SDK with a fresh-session fallback (`execution.ts:534-548`, `onResumeFallback` at `:155`); the `update` follow-up already exercises the full chain (`workflow.ts:852-888` passes `activeChange.sdkSessionId`), carries free-text `instructions` + `userFeedback`, and `sdkSessionId` is not tied to the worktree path. The single seam: after adoption, the dispatched continuation intent routes to `handleFollowUp("update", plan.description)` instead of proceeding through `startChangeWorkflow`'s fresh-execution branch.

### D3 — Liveness classification reuses the idle sweep's criteria

A claim/session is **live** iff its `activeChange` has `handle` set, OR `status ∈ {executing, reviewing, merging}` (the existing `ACTIVELY_EXECUTING_STATUSES`), OR `waiting` set (parked in the acquire queue). Live → adoption refused with a `t()` message naming the claiming conversation (`getActiveChangeRef(sessionId)` accessor over the existing `sessionRefs` map; generic fallback when the ref is unavailable). Everything else (`pr_created`, `failed`, terminal, no handle) is adoptable.

Adopting a `failed` session is allowed and carries `verificationAttempts` and the recovery semantics with it — the new conversation sees the same recovery ladder the old thread would have.

### D4 — Permission: owner or admin+

Adoption is allowed when the requesting user equals the change's `SessionRef.userId`, or the requester is admin+. Otherwise the refusal names the owner so Claude can suggest asking them. Rationale: adoption *moves* the follow-up surface (update/merge/close buttons) out of the owner's thread; that's fine for the owner themselves (the DM use case) and for admins, but dev-to-dev needs consent — deferred until a real need shows up.

### D5 — Orphan-claim fallback: reduced takeover

If a worker claims branch `B` but `claimedBy` has **no** `activeChange` (session expired, not restored after restart), there is nothing to adopt. The continuation then falls back to the previous design's takeover mechanics, scoped to orphans only: on `AlreadyInFlight` (which gains structured readonly `repo`/`branch`/`claimedBy` fields), verify orphanhood, `getReusablePool()?.detachIfClean(worker, { treatUnpushedAsDirty: true })`, retry the acquire **once**. Dirty → quarantine (existing owner-DM/Home-Tab path) and the change fails with the quarantine explanation. `treatUnpushedAsDirty` is unconditionally true for orphans — with no session state to consult, the conservative policy protects unpushed commits.

Since adoption handles every claims-holder-still-exists case, a non-orphan `AlreadyInFlight` reaching this point means a race (someone claimed between the adoption check and acquire) — surfaced as the live refusal, never retried in a loop.

### D6 — Detached follow-up re-acquire uses resume mode for PR-backed changes

`handleFollowUp`'s re-acquire (`workflow.ts:711`) passes `resumeRemoteBranch: true` whenever `activeChange.prUrl` is set (or status is `pr_created`). Without this, a cold re-acquire rebases the branch off `origin/<default>` and the PR's commits vanish from the worktree. This is a pre-existing gap that adoption would hit constantly (adopted-from-a-wound-down-thread changes are usually cold), so it ships in this change. `RemoteBranchNotFound` (branch deleted remotely) surfaces as the follow-up error rather than silently rebuilding.

### D7 — Tombstone for the adopted-away conversation

`activeState.ts` keeps an in-memory `adoptedAway: Map<oldSessionId, SessionRef /* new home */>`. The change action-button handlers consult it before the "no active change" error and answer with "this change moved to <#channel>" (`t()` string). Deliberately **not persisted**: after a restart the old thread's buttons fall back to the existing no-active-change message, which is acceptable degradation for a stale thread. The map is bounded by one entry per adoption and cleared if the same branch is ever adopted back.

### D8 — `propose_change` becomes pool-based and session-aware

Replace the `getExistingWorktree` dep with `findByBranch(repoName, branch)` (default: the pool accessor in `src/workers/index.ts`) plus the branch→session lookup from D1. The tool result's `existingWorktree` metadata gains a `continuation` field:

- `"resume-here"` — the session already belongs to this conversation (plain follow-up)
- `"adopt"` — a session exists in another conversation and is adoptable → text tells Claude it will be moved here, with owner named
- `"live"` — a run is executing in another conversation → text tells Claude to steer the user there
- `"fresh"` — no session; the branch may still exist remotely (normal cold continuation)

Claude-facing text stays English (via-Claude path). Propose-time reporting is advisory — enforcement happens at execution (D1/D3/D4); pool/session state may change before the button click. Disposable mode: `findByBranch` returns the path-derived pseudo-worker (`claimedBy: null`) and the session lookup works identically, so disposable keeps its existing-worktree hint and gains session awareness.

### D9 — Monitor loops re-check claim identity after awaits

The changes monitor holds sessionIds across `await` boundaries, so an adoption can interleave: the idle sweep captures `worker.claimedBy` before `getSession(...)` (`monitor.ts:188-194`) and could detach the *adopted* session; the completion check iterates a `getActiveWorkers()` snapshot (`monitor.ts:254+`) that goes stale the same way. Both loops gain a cheap guard: after each await, re-check that `worker.claimedBy` (resp. the session's `activeChange`) still matches what was captured, and skip the entry otherwise. This hardens the monitor against ALL concurrent claim transitions, not just adoption.

## Risks / Trade-offs

- **[Old thread loses its buttons]** → intended single-ownership semantics; tombstone reply routes users to the new home; degradation after restart is a generic error on a thread the user already abandoned. Buttons encode `{s: sessionId}` (`blocks.ts:79-103`), so a transparent redirect map (old→new sessionId) was considered and REJECTED: it would let the old thread keep driving a change homed elsewhere — multi-home semantics by the back door.
- **[Race: run starts in the old thread between liveness check and re-home]** → the adoption steps are synchronous in-process after the check (map moves + claim reassignment, no awaits between check and move beyond the initial lookups); a run can only start via that session's handlers, which re-read `activeChanges` — after the move they find nothing and tombstone. Residual interleavings degrade to one side getting a clean refusal.
- **[Race: monitor loops vs adoption]** → covered by D9's post-await re-checks.
- **[Queued session adopted mid-wait]** → cannot happen: `waiting` classifies as live (D3), so adoption refuses; queue entries never need remapping.
- **[Adopted `merging`/half-way states]** → excluded by D3 (actively-executing statuses are live). Only parked states move.
- **[`reassignClaim` on a worker mid-quarantine]** → adoption only reassigns when the worker's status is `busy` and `claimedBy` matches the adopted session; quarantined workers keep their record untouched (rescue flows unchanged).
- **[D6 changes follow-up behavior outside adoption]** → deliberate: it fixes a commit-clobbering gap for every cold detached follow-up, not just adopted ones. `RemoteBranchNotFound` on a deleted branch is a better failure than silently rebuilding from default.
- **[In-memory branch→session scan]** → `activeChanges` is small (bounded by concurrent changes); linear scan matches existing `getActiveChangeForUser` style.

## Migration Plan

No config, schema, or data migration. The persisted session format is unchanged (channel/threadTs were always part of it — adoption just writes new values). Ships as a normal deploy; rollback = revert.

## Open Questions

- Should adoption proactively post a note in the old thread ("continuing in <#channel>") instead of only answering reactively via tombstone? Needs a Slack client at the workflow layer or an event seam; deferred.
- Should `find_changes` surface adoptability (e.g. "this change can be continued here") so Claude can offer adoption without the user naming the branch? Nice-to-have; not required for the core flow.
