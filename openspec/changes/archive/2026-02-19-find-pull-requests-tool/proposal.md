## Why

After an app restart, in-memory change sessions are lost. Claude has no way to discover that a PR already exists for a branch, so it proposes a new change instead of an update — resulting in a duplicate PR creation error. A `find_pull_requests` query tool gives Claude visibility into existing GitHub PRs regardless of session state.

Additionally, `createPR` should be renamed to `ensurePR` to reflect its new idempotent behavior (check-then-create).

## What Changes

- Add `find_pull_requests` MCP query tool that queries GitHub for open PRs on a repository, with optional branch name filtering
- Rename `createPR` to `ensurePR` across the codebase to reflect its idempotent check-then-create behavior
- Register `find_pull_requests` for dev+ roles alongside existing query tools (`find_changes`, `find_sessions`)

## Capabilities

### New Capabilities

_None — this extends the existing `clack-tools` capability._

### Modified Capabilities

- `clack-tools`: Adding a new query tool (`find_pull_requests`) to the tool server
- `changes-workflow`: Renaming `createPR` to `ensurePR` and updating the PR creation requirement to reflect idempotent behavior

## Impact

- `src/tools/query/` — new `findPullRequests.ts` tool file
- `src/tools/server.ts` — register the new tool for dev+ roles
- `src/changes/pr.ts` — rename `createPR` → `ensurePR` (already has the check-then-create logic)
- `src/changes/workflow.ts` — update call site for the rename
