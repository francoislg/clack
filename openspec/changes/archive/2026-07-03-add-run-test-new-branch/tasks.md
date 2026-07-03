# Tasks — add-run-test-new-branch

## 1. Tool change

- [x] 1.1 Add optional `new_branch: z.boolean()` to the `run_test` schema in `src/tools/actions/runTest.ts`, described as: create a fresh throwaway branch off the default branch instead of resuming an existing remote branch — use when the user asks to test/record current behavior rather than a PR, and name the branch a throwaway slug (e.g. `test/record-feature-x`)
- [x] 1.2 Stage the intent with `resumeRemoteBranch: !args.new_branch` (keep all other staged fields unchanged)
- [x] 1.3 Reword the tool description and `branch` arg description so "must already exist on remote" applies only when `new_branch` is not set
- [x] 1.4 Adjust the staged `description` string conditionally: when `new_branch: true`, use "Test the app on a fresh branch off <repo default branch>: <test_focus>"; when `new_branch` is omitted or `false`, keep the existing "Test the app on branch <branch>: <test_focus>" format unchanged

## 2. Tests

- [x] 2.1 In `src/tools/actions/runTest.test.ts`, assert the staged intent carries `resumeRemoteBranch: false` when `new_branch: true`
- [x] 2.2 Assert `resumeRemoteBranch: true` when `new_branch` is omitted and when explicitly `false` (unchanged default)
- [x] 2.3 Add a new test case asserting the protected-branch guard rejects `main`/the repo default branch even when `new_branch: true` is passed

## 3. Verification

- [x] 3.1 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check` on touched files, and `npm run test`
- [x] 3.2 Validate the change with `openspec validate add-run-test-new-branch --strict`
