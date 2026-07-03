# Add `new_branch` to `run_test` — record features without a PR

## Why

Tester runs are currently coupled to an existing remote branch: `run_test` hardcodes `resumeRemoteBranch: true`, so a branch that doesn't exist on origin fails the run with `RemoteBranchNotFound`, and the protected-branch guard blocks targeting `main` directly. There is no way to say "record how feature X works today" — every recording requires an open PR. The tester never pushes, so a throwaway branch cut from the default branch is perfectly safe and the fresh-branch acquire path already exists (it is the implement-worker default).

## What Changes

- `run_test` gains an optional `new_branch: boolean` argument. When `true`, the staged intent uses `resumeRemoteBranch: false`, so the worktree acquires a fresh branch off `origin/<default>` instead of resuming an existing remote branch.
- Claude names the throwaway branch itself (e.g. `test/record-feature-x`); the existing protected-branch guard stays as-is and still applies.
- The tool and `branch` descriptions are reworded so "must already exist on remote" applies only when `new_branch` is not set, and Claude knows to use `new_branch: true` when the user asks to test/record current behavior rather than a PR.
- Default behavior (arg omitted) is byte-for-byte today's behavior: resume the existing remote branch, fail on a missing one.
- No changes to `workflow.ts`, worktree acquisition, the tester toolbelt, or the tester prompt — both acquire paths already exist downstream.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `tester-mode`: The "staged via a run_test action intent" requirement gains a fresh-branch mode (`new_branch: true` → intent staged with `resumeRemoteBranch: false`). The "acquires a worktree on the target branch" requirement is scoped: resume-from-remote-head (and its missing-branch failure) applies only to the default mode; the new mode acquires a fresh branch from `origin/<default>`.

## Impact

- `src/tools/actions/runTest.ts` — new zod arg, staged-intent wiring, description rewording.
- `src/tools/actions/runTest.test.ts` — new test cases for the `new_branch` path.
- No config, schema-file, migration, prompt, or i18n changes (tool descriptions are on the via-Claude path and stay English).
