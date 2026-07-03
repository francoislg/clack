# Design — add-run-test-new-branch

## Context

`run_test` (`src/tools/actions/runTest.ts`) stages a `kind: "test"` change intent with `resumeRemoteBranch: true` hardcoded. Downstream, worktree acquisition already supports both modes: `resumeRemoteBranch: true` checks out `origin/<branch>` (throwing `RemoteBranchNotFound` when absent), `false` runs `git checkout -B <branch> origin/<default>` — the implement-worker default. The tester toolbelt is read-only (no push tools, `Write`/`Edit` disallowed, bash guard blocks git mutations), so a fresh local branch is a throwaway label with no remote footprint.

## Goals / Non-Goals

**Goals:**

- Let a tester run record current behavior (no PR) by cutting a fresh branch off the default branch.
- Keep the choice explicit and Claude-driven — no acquire-time remote-existence probing, no silent fallback.
- Zero behavior change when the new arg is omitted.

**Non-Goals:**

- Testing the protected branch in place (`branch: "main"` stays rejected; the fresh branch is content-identical anyway).
- Any change to `propose_change` (it already has the inverse knob, `continue_existing_pr`).
- Changes to worktree acquisition, `workflow.ts`, the tester prompt, or the toolbelt.

## Decisions

- **Explicit `new_branch: boolean` arg over resume-if-exists.** An acquire-time `git ls-remote` fallback was considered and rejected: a typo'd PR branch would silently record the default branch instead of the PR, and staging is deliberately cheap (no git calls). With an explicit arg, Claude decides from conversation context and a typo still fails loudly via `RemoteBranchNotFound`.
- **`branch` stays required.** Claude names the throwaway (e.g. `test/record-feature-x`). Auto-generating a name when omitted was considered but adds schema complexity for no real gain — Claude is already the one composing the intent, and the name shows up in the thread/Home Tab where a meaningful slug helps.
- **Wire as `resumeRemoteBranch: !new_branch`.** The staged intent field already threads `run_test → StagedChangeIntent → ChangePlan → switchBranch/createWorktree`; no new plumbing.
- **Protected-branch guard unchanged.** It applies in both modes. Under `new_branch: true` it also prevents a confusing footgun: `checkout -B main origin/<default>` would "work" but shadow the real branch name.

## Risks / Trade-offs

- [Claude sets `new_branch: true` on a real PR branch name] → the run silently tests a fresh copy of default instead of the PR. Mitigated by the tool description (fresh mode is for "current behavior" requests) and by the fact that the confirmation button text carries the description, which says what's being tested.
- [Local branch litter in reusable workers] → none beyond today: workers already `checkout -B` per request and release resets to `origin/<default>`; disposable worktrees are deleted wholesale.

## Migration Plan

None — additive optional arg, no config/schema/state changes. Rollback is reverting the commit.

## Open Questions

None.
