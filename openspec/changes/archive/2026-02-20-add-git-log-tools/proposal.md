## Why

In query mode, Claude has read access to local repository clones via `Read`, `Glob`, and `Grep` — but `Bash` is disallowed, so it cannot run `git log`. Users asking about commit history, recent changes, or authorship have no way to get that information. Adding git log access as a query tool fills this gap using the existing `simple-git` dependency and local clones.

## What Changes

- **New `git_log` query tool**: Runs `git.raw(["log", ...args])` on a local repo clone. Accepts arbitrary git log arguments as a string array, returning raw output plus shallow-clone metadata (is shallow, available commit count, may be truncated).
- **New `deepen_history` query tool**: Runs `git.raw(["fetch", "--deepen=N"])` or `git.raw(["fetch", "--unshallow"])` on a local repo clone to expand shallow history when `git_log` hits the shallow boundary. Requires authenticated remote refresh before fetching.
- Both tools validate repository access via `getVisibleRepos()` — users can only query repos they can read.
- Both tools are available to **all roles** (not gated behind `canRequestChanges`), since they are purely read-only operations.

## Capabilities

### New Capabilities
- `git-log-tools`: Git history query tools (`git_log` and `deepen_history`) for accessing commit history on local repository clones in query mode.

### Modified Capabilities
- `clack-tools`: Add `git_log` and `deepen_history` to the query tool set with role-gating rules (available to all roles).
- `repository-management`: Document that `deepen_history` may expand shallow clones via `git fetch --deepen` during query mode.

## Impact

- **New files**: `src/tools/query/gitLog.ts`, `src/tools/query/deepenHistory.ts`
- **Modified files**: `src/tools/server.ts` (register new tools in `buildQueryTools`)
- **Dependencies**: Uses existing `simple-git` and `getVisibleRepos` — no new dependencies
- **Side effects**: `deepen_history` modifies local clone state (downloads more objects), similar to how the sync scheduler already runs `git pull` periodically
