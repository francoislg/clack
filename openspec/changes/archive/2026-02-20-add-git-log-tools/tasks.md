## 1. git_log Tool

- [x] 1.1 Create `src/tools/query/gitLog.ts` with `createGitLogTool(ctx)` factory function
- [x] 1.2 Implement repo access validation via `getVisibleRepos()`
- [x] 1.3 Implement repo path resolution and directory existence check
- [x] 1.4 Implement shallow clone metadata detection (`rev-parse --is-shallow-repository`, `rev-list --count HEAD`)
- [x] 1.5 Implement `git.raw(["log", ...args])` execution with 100K output truncation
- [x] 1.6 Return structured response with `output`, `shallow`, `availableCommits`, `truncated` fields

## 2. deepen_history Tool

- [x] 2.1 Create `src/tools/query/deepenHistory.ts` with `createDeepenHistoryTool(ctx)` factory function
- [x] 2.2 Implement repo access validation and shallow-check guard (skip fetch if not shallow)
- [x] 2.3 Export `setAuthenticatedRemote` from `repositories.ts` (currently module-private)
- [x] 2.4 Implement `git fetch --deepen=N` and `git fetch --unshallow` paths with authenticated remote refresh
- [x] 2.5 Return updated shallow status and available commit count

## 3. Tool Registration

- [x] 3.1 Import both tool factories in `src/tools/server.ts`
- [x] 3.2 Register `git_log` and `deepen_history` in `buildQueryTools()` for all roles (alongside `list_repositories`, before the `canRequestChanges` block)
