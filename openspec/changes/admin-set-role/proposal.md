## Why

Role management currently only works through the Home Tab UI (buttons to add/remove admins and devs). Admins should be able to manage roles conversationally ("make @alice an admin", "remove @bob's dev access"). Additionally, the low-level role functions (`addAdmin`, `removeAdmin`, `addDev`, `removeDev`) model roles as independent lists rather than a hierarchy — the new tool's mental model ("set role to X") is cleaner and should be reflected in the underlying API.

## What Changes

- Add `admin_set_role` MCP tool: sets a user's role to `admin`, `dev`, or `member`, automatically adjusting the role lists (promoting removes from lower lists, demoting removes from higher lists)
- Refactor `roles.ts`: replace `addAdmin`/`removeAdmin`/`addDev`/`removeDev` with a unified `setRole(userId, role)` function that cascades correctly
- Update Home Tab handlers to use `setRole` instead of the individual functions
- Add tool mapping label

## Capabilities

### New Capabilities
- `admin-role-tool`: MCP tool for admins to set user roles via conversation, with cascading role hierarchy

### Modified Capabilities
- `user-roles`: Replace four individual add/remove functions with a unified `setRole` function
- `clack-tools`: Add `admin_set_role` to admin role tool registration

## Impact

- **New files**: `src/tools/admin/adminSetRole.ts`
- **Modified files**: `src/roles.ts` (unify functions), `src/slack/handlers/homeTab.ts` (use setRole), `src/tools/server.ts` (register tool), `data/default_configuration/tool_mapping/clack.json` (add label)
- **Tests to update**: `src/roles.test.ts`, `src/slack/handlers/homeTab.test.ts`
- **No new dependencies**
