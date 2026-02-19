## 1. Rename createPR to ensurePR

- [x] 1.1 Rename `createPR` function to `ensurePR` in `src/changes/pr.ts` and update its export
- [x] 1.2 Update the call site in `src/changes/workflow.ts` to use `ensurePR`

## 2. Add find_pull_requests MCP tool

- [x] 2.1 Create `src/tools/query/findPullRequests.ts` following the pattern of `findChanges.ts` — accepts `repo` (required) and `branch` (optional), queries GitHub via Octokit, filters by user's visible repos, returns PR summaries
- [x] 2.2 Register `find_pull_requests` in `src/tools/server.ts` for dev+ roles alongside `find_sessions` and `find_changes`

## 3. Verify

- [x] 3.1 Run `npx tsc --noEmit` to verify no type errors
