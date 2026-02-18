## Why

All configured repositories are currently visible to all users regardless of role. Sensitive repos (e.g., infrastructure/terraform) should only be visible to certain roles, and write access should be independently controllable. The existing `supportsChanges` boolean doesn't express _who_ can make changes.

## What Changes

- **BREAKING**: Remove `supportsChanges` from `RepositoryConfig`, replaced by `access.write`
- Add optional `access` property to repository config with `read` and `write` role thresholds
- Filter repositories by user role across all surfaces: `list_repositories` tool, `allowed_directories` for Claude, `propose_change` validation, and Home tab
- Centralize access-checking logic into a single module (avoid spreading role checks across files)
- Show per-repo access levels on the Home tab for dev+ users; members see only the repos they can access with no access tags

## Capabilities

### New Capabilities
- `repo-access-control`: Centralized per-repository role-based access control with read/write thresholds

### Modified Capabilities
- `repository-management`: Replace `supportsChanges` boolean with `access.write` role threshold; add `access.read` for visibility gating
- `clack-tools`: Filter `list_repositories` results and `propose_change` targets by the user's role and repo access
- `home-tab`: Filter repository list by user's read access; show access tags (read/write thresholds) for dev+ users only

## Impact

- **Config**: `data/config.json` — repos gain `access` object, `supportsChanges` removed
- **Core**: New `src/repoAccess.ts` module for centralized access checks
- **Tools**: `listRepositories.ts`, `proposeChange.ts` — filter by role
- **Claude invocation**: `claude.ts` — filter `allowed_directories` by role
- **Home tab**: `homeTab.ts` — filtered repo list with access display
- **Validation**: `config.ts` — new validation for `access` property, remove `supportsChanges` validation
