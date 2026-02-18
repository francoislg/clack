## Context

Repositories are configured in `data/config.json` under the `repositories` array. Today every repo is visible to every user — Claude gets all repo directories in `allowed_directories`, `list_repositories` returns all repos, and the Home tab shows all repos. The only per-repo gating is the `supportsChanges` boolean, which controls whether `propose_change` can target a repo, and the global `canRequestChanges(role)` check which gates dev+ users.

The `permissions.ts` module already centralizes role-based checks (`canEditConfig`, `canRequestChanges`, `canManageRoles`). The role hierarchy is: `member < dev < admin < owner`.

## Goals / Non-Goals

**Goals:**
- Per-repository `read` and `write` role thresholds via an `access` config property
- Centralized access-checking logic in a single module (not scattered across tools, Claude invocation, and home tab)
- Hard gating: repos below the user's read threshold are invisible everywhere (tools, filesystem access, home tab)
- Replace `supportsChanges` with the presence of `access.write` — breaking change, no backwards compatibility shim

**Non-Goals:**
- Per-user repo allowlists (only role-based thresholds)
- Channel-scoped repo visibility (same access everywhere)
- Runtime access changes (config reload required)

## Decisions

### D1: Centralize in `src/repoAccess.ts`

Create a new module `src/repoAccess.ts` that exports:
- `canReadRepo(role: UserRole, repo: RepositoryConfig): boolean`
- `canWriteRepo(role: UserRole, repo: RepositoryConfig): boolean`
- `getVisibleRepos(role: UserRole, repos: RepositoryConfig[]): RepositoryConfig[]`
- `getWritableRepos(role: UserRole, repos: RepositoryConfig[]): RepositoryConfig[]`

All call sites use these functions instead of inline checks. The existing `permissions.ts` stays focused on feature-level permissions (edit config, manage roles); `repoAccess.ts` handles repo-level access.

**Why not merge into `permissions.ts`?** Repo access depends on both the role AND the repo config — it's a different shape from the pure role-based checks in `permissions.ts`. Keeping them separate avoids a circular dependency (permissions shouldn't import config types).

### D2: Role hierarchy comparison via numeric levels

Map roles to numeric levels for threshold comparison:
```
member=0, dev=1, admin=2, owner=3
```

`canReadRepo` checks `roleLevel(userRole) >= roleLevel(repo.access?.read ?? "member")`.
`canWriteRepo` checks `access.write` is defined AND `roleLevel(userRole) >= roleLevel(repo.access.write)`.

This avoids long `if/else` chains and makes the hierarchy explicit.

### D3: `access` property shape

```typescript
interface RepoAccess {
  read?: UserRole;   // min role to see repo — default "member"
  write?: UserRole;  // min role to propose changes — omit = read-only
}

interface RepositoryConfig {
  name: string;
  url: string;
  description: string;
  branch?: string;
  access?: RepoAccess;  // omit = read-only, visible to all
  mergeStrategy?: "squash" | "merge" | "rebase";
  worktreeBasePath?: string;
}
```

Derived: `supportsChanges` ≡ `!!access?.write`. Remove the old field entirely.

### D4: Filtering touch points

| Surface | Current behavior | New behavior |
|---------|-----------------|--------------|
| `list_repositories` tool | Returns all repos | Returns `getVisibleRepos(role, repos)` |
| `propose_change` tool | Checks `supportsChanges` | Uses `canWriteRepo(role, repo)` |
| `allowed_directories` in Claude call | All repo dirs | Only dirs for `getVisibleRepos(role, repos)` |
| Home tab repos section | Lists all repos | Lists `getVisibleRepos(role, repos)`, shows access tags for dev+ |
| `find_changes` / `find_sessions` | Returns all | Filter results to visible repos |

### D5: Home tab display rules

- **Members**: see only repos they can read, no access tags shown
- **Dev+**: see repos they can read, each with access tags: `read: all · write: dev+` (or similar)
- Read-only repos (no `write`): show `read-only` tag instead of omitting write info

## Risks / Trade-offs

- **[Breaking config change]** → Hard break. Document in release notes. Simple migration: replace `"supportsChanges": true` with `"access": { "write": "dev" }`.
- **[Prompt-level leakage]** Claude's system prompt or instructions might mention repo names even if filesystem access is removed. → Filter repo references in system prompt construction too (instructions.ts already scopes by config).
- **[Stale worktrees]** If a repo's read access is raised after worktrees exist for lower-role users. → Worktrees are ephemeral and session-scoped; stale ones get cleaned up by existing expiry logic.
