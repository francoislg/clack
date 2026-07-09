# Change Session Adoption

## Why

A change session is bound to the conversation that created it (sessionId = channel-threadTs-user), but the work itself — branch, PR, worker claim, SDK conversation — outlives any single Slack thread. Asking to continue a PR from another conversation (e.g. a DM after the original channel thread wound down) currently collides with the original session's worker claim and dies with an opaque `Failed to create workspace: Branch '...' is already in flight`, even though nothing is running. Even if the collision were forced through, a fresh session would lose the worker's conversational context (`sdkSessionId`) and leave two sessions fighting over one branch.

## What Changes

- **Change session adoption (primary path)**: when a continuation (`propose_change` + `continue_existing_pr`) targets a branch whose change session is alive in another conversation, the workflow **re-homes that session** into the requesting conversation instead of creating a new one — same `activeChange` (status, `prUrl`, `sdkSessionId`, verification counters), new conversation binding, worker claim reassigned. The worker Claude resumes with its full context; exactly one session references the branch at all times. Adoption is gated: same user as the change's owner, or admin+.
- **Old conversation gets a tombstone**: after adoption, the original thread's action buttons answer with a friendly "this change moved to <#channel>" (in-memory forward pointer; post-restart clicks degrade to the existing no-active-change message).
- **Liveness guard**: adoption is refused while the claiming session has a live run (handle set / actively-executing status / queued), with a message pointing at the claiming conversation.
- **Orphan-claim fallback (reduced takeover)**: when the claiming session no longer exists (expired, not restored), there is nothing to adopt — the stale claim is detached via the idle sweep's clean-detach mechanics (dirty → quarantine, `failed`-status unpushed-commit protection) and the acquire retried once.
- **Propose-time claim awareness (reusable-mode parity fix)**: `propose_change`'s existing-work check switches from the disposable-only path probe (`getExistingWorktree`) to the mode-agnostic `pool.findByBranch`, and reports what continuation will do: adopt from another conversation, resume in place, or refuse (live).
- **Detached follow-up re-acquire preserves PR commits**: the follow-up re-acquire path acquires in resume-from-remote-branch mode when the change has a PR, closing a latent gap where a cold re-acquire would rebuild the branch from `origin/<default>`.

## Capabilities

### New Capabilities

_None — this refines existing continuation/acquire behavior._

### Modified Capabilities

- `changes-workflow`: "Continue an Existing Pull Request" gains cross-conversation continuation via adoption (with liveness guard, tombstone, and orphan fallback); "Existing worktree detection" in `propose_change` becomes pool-based and claim-aware; the detached follow-up re-acquire uses resume mode for PR-backed changes.
- `worker-pool`: the busy-worker acquire collision error carries structured fields (`repo`, `branch`, `claimedBy`); the reusable pool exposes claim reassignment (adoption) alongside the existing `detachIfClean` (orphan fallback); the pool stays claim-liveness-agnostic.

## Impact

- `src/changes/activeState.ts` — re-home operation (move `activeChange` + ref to a new sessionId), ref accessor, tombstone map for adopted-away sessions.
- `src/changes/workflow.ts` — adoption branch in the continuation path; orphan-claim fallback; follow-up re-acquire passes `resumeRemoteBranch` when `prUrl` is set.
- `src/workers/reusablePool.ts` / `errors.ts` — `reassignClaim(worker, newSessionId)`; structured `AlreadyInFlight` fields. No pool knowledge of sessions.
- `src/tools/actions/proposeChange.ts` — pool-based `findByBranch` dep + claim/session state in the tool result.
- `src/slack/handlers/` (change action buttons) — tombstone-aware "moved" reply.
- `src/i18n/strings/en.ts` / `fr.ts` — moved-tombstone, live-refusal, and adoption-ack strings.
- No config changes; disposable mode unaffected on the claim path (it never throws `AlreadyInFlight`), and adoption itself works identically there (no claim to reassign).
