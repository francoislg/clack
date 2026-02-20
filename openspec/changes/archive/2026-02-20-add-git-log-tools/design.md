## Context

Query mode sets `cwd` to `data/repositories/` and allows `Read`, `Glob`, `Grep` but disallows `Bash`. This means Claude can browse source files but cannot run `git log` to answer questions about commit history, authorship, or recent changes. The `simple-git` library is already a project dependency used by `repositories.ts` and `worktrees.ts`. Repos are cloned locally and synced on a configurable interval, but may be shallow clones (configurable via `git.shallowClone` and `git.cloneDepth`).

## Goals / Non-Goals

**Goals:**
- Give Claude full `git log` capabilities on local repository clones in query mode
- Support all git log parameters via raw argument passthrough
- Surface shallow-clone metadata so Claude can decide when to deepen
- Provide a tool to expand shallow history on demand

**Non-Goals:**
- Parsing or structuring git log output (Claude handles interpretation)
- Supporting other git commands beyond `log` and `fetch --deepen/--unshallow`
- Modifying the sync scheduler or clone configuration

## Decisions

### 1. Raw argument passthrough via `git.raw()`

Use `simple-git`'s `git.raw(["log", ...args])` instead of the structured `.log()` method.

**Rationale:** `.log()` supports ~10 options. Git log has 50+. Claude already knows git log syntax — re-modeling it in Zod adds complexity with no benefit. `git.raw()` passes each array element as a separate argv entry to the git binary, so there is no shell injection risk.

**Alternative considered:** Structured Zod schema with common options + `extraArgs` escape hatch. Rejected as unnecessary complexity — the consumer is Claude, not a human UI.

### 2. Two separate tools (`git_log` + `deepen_history`)

**Rationale:** Keeps each tool focused. `git_log` is pure read, `deepen_history` has side effects (network I/O, disk writes). Claude can inspect `git_log` metadata and reason about whether to deepen before taking action.

**Alternative considered:** Single `git_log` tool with `ensure_depth` parameter that auto-deepens. Rejected because it hides the side effect and makes it harder for Claude to reason about trade-offs (network cost, time).

### 3. Available to all roles (no `canRequestChanges` gating)

**Rationale:** Both tools are read-only from a codebase perspective. `deepen_history` modifies local clone state but only by downloading more history — equivalent to what the sync scheduler already does. Any user who can read a repo should be able to see its commit history.

### 4. Authenticated remote refresh before deepen

`deepen_history` calls `setAuthenticatedRemote()` (from `repositories.ts`) before `git fetch` to ensure a fresh GitHub App token. This matches the pattern used by `pullRepository()`.

**Rationale:** GitHub App tokens expire. The remote URL contains the token, so it must be refreshed before any network operation.

### 5. Output truncation safety

`git_log` caps output at 100,000 characters with a truncation warning appended. This prevents a `git log -p` on a long history from blowing up Claude's context window.

**Rationale:** The tool response goes into Claude's context. Unbounded output would cause the query to fail or degrade quality. 100K is generous enough for most queries while staying safe.

## Risks / Trade-offs

- **Shallow clone limits history** → Mitigated by `deepen_history` tool and shallow metadata in `git_log` response. Claude can inform the user and offer to fetch more.
- **`deepen_history` has network latency** → Acceptable trade-off. Fetching is fast for incremental deepening. Full unshallow could be slow on large repos — Claude should prefer incremental deepening.
- **`deepen_history` modifies shared clone state** → Low risk. The sync scheduler already runs `git pull` on the same clones. Deepening only adds objects, never removes. Concurrent access is safe (git handles locking).
- **Large output from git log** → Mitigated by 100K character cap with truncation warning. Claude can use `--max-count`, `--oneline`, or other flags to reduce output.
