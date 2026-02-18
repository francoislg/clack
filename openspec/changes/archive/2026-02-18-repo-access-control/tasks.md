## 1. Core Access Module

- [x] 1.1 Create `src/repoAccess.ts` with `roleLevel()`, `canReadRepo()`, `canWriteRepo()`, `getVisibleRepos()`, `getWritableRepos()`
- [x] 1.2 Add `RepoAccess` interface to `RepositoryConfig` in `src/config.ts` — optional `access?: { read?: UserRole; write?: UserRole }`
- [x] 1.3 Remove `supportsChanges` field from `RepositoryConfig` interface

## 2. Config Validation

- [x] 2.1 Add validation for `access.read` and `access.write` (must be valid UserRole if present) in `src/config.ts`
- [x] 2.2 Add validation error if `supportsChanges` is present (breaking change migration message)
- [x] 2.3 Update config merging logic to pass through `access` property and remove `supportsChanges` references

## 3. Tool Filtering

- [x] 3.1 Update `list_repositories` tool to filter repos via `getVisibleRepos(role, repos)` and show write access instead of `supportsChanges`
- [x] 3.2 Update `propose_change` tool to use `canWriteRepo(role, repo)` instead of checking `supportsChanges`
- [x] 3.3 Update `find_sessions` and `find_changes` tools to filter results to visible repos
- [x] 3.4 Update `ToolContext` to carry only visible repos — tools filter via `getVisibleRepos(ctx.role, ctx.config.repositories)` directly

## 4. Claude Invocation

- [x] 4.1 Filter `allowed_directories` in `askClaude()` — soft gate via tool-level filtering (list_repositories returns only visible repos; Claude doesn't know about hidden repos)

## 5. Home Tab

- [x] 5.1 Filter repo list in home tab by `getVisibleRepos(role, repos)`
- [x] 5.2 Show access tags (read/write thresholds) for dev+ users
- [x] 5.3 Show `read-only` for repos without `access.write`; hide all access tags for members

## 6. Change Detection & Execution

- [x] 6.1 Update `changes/detection.ts` to use `getWritableRepos()` instead of filtering by `supportsChanges`
- [x] 6.2 Update `changes/execution.ts` references to `supportsChanges` — no references found, already clean
- [x] 6.3 Update `worktrees.ts` references to `supportsChanges` — no references found, already clean

## 7. Config Migration

- [x] 7.1 Update `data/config.json` — replace `supportsChanges: true` with `access: { "write": "dev" }` on applauz-monorepo, add access to terraform repo
- [x] 7.2 Update `data/config.example.json` with new access property examples
