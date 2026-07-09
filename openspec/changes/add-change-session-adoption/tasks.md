# Tasks — Change Session Adoption

## 1. activeState: re-home, lookups, tombstone

- [x] 1.1 Add `findActiveChangeByBranch(repo, branch): { sessionId, change } | undefined` to `src/changes/activeState.ts` (linear scan, `getActiveChangeForUser` style)
- [x] 1.2 Add `getActiveChangeRef(sessionId): SessionRef | undefined` over the existing `sessionRefs` map
- [x] 1.3 Add `adoptActiveChange(oldSessionId, newSessionId, newRef)`: move the `activeChanges` + `sessionRefs` entries, write the persisted session with the new ref (so restore rebinds to the new conversation), record a tombstone `adoptedAway: Map<oldSessionId, SessionRef>`, and expose `getAdoptedAwayRef(oldSessionId)`
- [x] 1.4 Add a liveness classifier (sessionId → `"live" | "adoptable" | "orphan"`): live = `handle` set OR status in `ACTIVELY_EXECUTING_STATUSES` OR `waiting`; orphan = no `activeChange`; else adoptable
- [x] 1.5 Unit tests: branch lookup, re-home moves both maps + persists new ref, tombstone set/read and cleared on adopt-back, classifier covers all statuses + handle + waiting + orphan

## 2. Pool: claim reassignment + structured collision error

- [x] 2.1 Add readonly `repo`, `branch`, `claimedBy` fields to `AlreadyInFlight` (`src/workers/errors.ts`); message unchanged
- [x] 2.2 Add `reassignClaim(worker, newSessionId)` to `ReusablePool`: only when status is `busy`; update `claimedBy` + `lastUsedAt` + persist; reject (return false or throw) for any other status
- [x] 2.3 Unit tests (`reusablePool.test.ts`): reassign happy path persists, non-busy statuses rejected, no branch/status/worktree mutation

## 3. Workflow: adoption path

- [x] 3.1 In the continuation flow of `startChangeWorkflow` (`src/changes/workflow.ts`), before acquiring: `findActiveChangeByBranch` → classify → adopt (owner-or-admin check via requesting user vs `SessionRef.userId` / role) → `adoptActiveChange` + `reassignWorkerClaim` when a busy worker holds the branch and `claimedBy` matches the adopted session
- [x] 3.2 Route the adopted continuation through the follow-up/update execution path (resume `sdkSessionId`), NOT a fresh `executeChange` prompt; cold adopted change re-acquires via the detached-follow-up path
- [x] 3.3 Live classification → refusal naming the claiming conversation (from `getActiveChangeRef`), generic fallback without a ref; permission denial → refusal naming the owner
- [x] 3.4 New `WorkflowDeps` seams (branch lookup, classifier, adopt, reassign, refs) with real defaults
- [x] 3.5 Unit tests (`workflow.test.ts`): DM adopts thread A's `pr_created` change (maps moved, claim reassigned, sdkSessionId preserved, follow-up path used); live → refusal, nothing mutated; non-owner dev → refusal; admin → allowed; adopted `failed` change keeps `verificationAttempts` + recovery ladder

## 4. Workflow: orphan-claim fallback

- [x] 4.1 On `AlreadyInFlight` during acquire (initial or follow-up re-acquire): if the classifier says orphan → `detachStaleClaimedWorker` (treatUnpushedAsDirty: true), then retry acquire exactly once; non-orphan → live refusal; dirty → quarantine explanation, no retry
- [x] 4.2 Unit tests: orphan detached + retry succeeds; dirty orphan → quarantine message; second collision after retry → refusal (no loop); disposable mode unaffected (error passes through untouched)

## 4b. Monitor hardening (D9)

- [x] 4b.1 Idle sweep (`monitor.ts:runIdleSweep`): after each await, re-check `worker.claimedBy` still equals the captured sessionId; skip otherwise
- [x] 4b.2 Completion check (`monitor.ts:runCompletionCheck`): after `getSession`, re-verify the session's `activeChange` still corresponds to the snapshot entry (branch match); skip otherwise
- [x] 4b.3 Log claim reassignments (in `ReusablePool.reassignClaim`) so interleavings are observable
- [x] 4b.4 Unit tests: sweep skips a worker whose claim moved mid-iteration; completion check skips a moved session

## 5. Follow-up re-acquire resume mode (latent gap fix)

- [x] 5.1 The detached-follow-up re-acquire (~`workflow.ts:711`) passes `resumeRemoteBranch: true` when `activeChange.prUrl` is set or status is `pr_created`
- [x] 5.2 Unit tests: cold `pr_created` follow-up acquires in resume mode; `RemoteBranchNotFound` surfaces as the follow-up error; non-PR failed change keeps today's default-branch acquire

## 6. Tombstone reply in Slack handlers

- [x] 6.1 In the change action-button handlers, when the sessionId has no `activeChange`, consult `getAdoptedAwayRef` and reply with the "moved to <#channel>" message before falling back to the no-active-change error
- [x] 6.2 Add `en`/`fr` strings: moved-tombstone, live-collision refusal (with and without channel), adoption acknowledgement, owner-gated refusal (`src/i18n/strings/en.ts`, `fr.ts`)
- [x] 6.3 Test: tombstone reply when present, existing fallback when absent

## 7. Claim/session-aware propose_change

- [x] 7.1 Replace the `getExistingWorktree` dep in `src/tools/actions/proposeChange.ts` with mode-agnostic `findWorkerByBranch(repoName, branch)` (default: pool accessor from `src/workers/index.ts`) + the branch→session lookup; keep `readSessionState` for status/lastActivity
- [x] 7.2 Add `continuation: "resume-here" | "adopt" | "live" | "fresh"` to the tool-result metadata with Claude-facing English text per state (adopt names the owner; live steers to the claiming conversation)
- [x] 7.3 Update `proposeChange.test.ts`: reusable-mode busy worker now detected; each continuation state mapped; disposable-mode pseudo-worker still reports existing work and gains session awareness

## 8. Verification

- [x] 8.1 `npx tsc`, `npm test`, `npx oxlint` / `npx oxfmt` on touched files
- [ ] 8.2 Manual sanity (reusable mode): create change → PR in a channel thread; from a DM, "continue PR X" → adoption ack, worker resumes with context, old thread button answers "moved"; retry while a run executes → refusal names the thread; expire/kill the session → orphan fallback detaches and continues
