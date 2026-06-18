## 1. Shared protected-branch helper

- [x] 1.1 In `src/changes/branchNaming.ts`, add `PROTECTED_BRANCH_NAMES` + `isProtectedBranchName(branch, defaultBranch)`; repoint `src/tools/worker/gitPush.ts` at it (drop its private copy)

## 2. Relax the tool gate

- [x] 2.1 In `src/tools/actions/proposeChange.ts`, gate the `BRANCH_PATTERN.test` rejection behind `!args.continue_existing_pr` so the convention is enforced only for new branches
- [x] 2.2 In `src/tools/actions/proposeChange.ts`, refuse protected branches (`isProtectedBranchName`) regardless of `continue_existing_pr`
- [x] 2.3 Broaden the `continue_existing_pr` zod description to cover continuing an existing remote branch with or without an open PR

## 3. Relax the worktree backstop

- [x] 3.1 In `src/worktrees.ts` `createWorktree`, skip the `isValidBranchName` backstop when `resumeRemoteBranch` is true (keep it for the new-branch path), but still refuse protected branches

## 4. Tests

- [x] 4.1 Add a `proposeChange` test: a non-convention branch with `continue_existing_pr: true` is accepted (no error); without the flag it is still rejected
- [x] 4.2 Add a `proposeChange` test: a protected branch (`main`) with `continue_existing_pr: true` is still rejected
- [x] 4.3 Add `createWorktree` tests: `resumeRemoteBranch: true` bypasses the `isValidBranchName` throw; `false` still throws on a non-convention name; protected branches throw regardless

## 5. Verify

- [x] 5.1 Run `npx tsc`, `npx oxlint` on changed files, and `npm test`
- [x] 5.2 Run `openspec validate relax-clack-prefix-on-continue --strict`
