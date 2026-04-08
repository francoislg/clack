## 1. Unify role functions in roles.ts

- [x] 1.1 Add `setRole(userId: string, role: "admin" | "dev" | "member")` function to `src/roles.ts` with cascading logic and owner protection
- [x] 1.2 Removed `addAdmin`, `removeAdmin`, `addDev`, `removeDev` (replaced by setRole) around `setRole` (for backwards compat during migration)
- [x] 1.3 Update `src/roles.test.ts` — add tests for `setRole` (promote, demote, idempotent, owner rejection, cascade)

## 2. Migrate Home Tab handlers

- [x] 2.1 Update `src/slack/handlers/homeTab.ts` to call `setRole` instead of individual add/remove functions
- [x] 2.2 Update `src/slack/handlers/homeTab.test.ts` to reflect new call pattern
- [x] 2.3 Remove the old `addAdmin`/`removeAdmin`/`addDev`/`removeDev` thin wrappers from `roles.ts` and update all imports

## 3. Implement admin_set_role tool

- [x] 3.1 Implement `admin_set_role` tool in `src/tools/admin/adminSetRole.ts` — takes `user` (Slack user ID) and `role` ("admin" | "dev" | "member"), calls `setRole`
- [x] 3.2 Register in `src/tools/server.ts` gated by `canEditConfig(ctx.role)`
- [x] 3.3 Add tool mapping label in `data/default_configuration/tool_mapping/clack.json` (e.g., "Admin - Setting {user} to {role}")

## 4. Tests

- [x] 4.1 Tests covered by `setRole` tests in `roles.test.ts` (9 tests — promote, demote, cascade, idempotent, owner rejection) tool — promote, demote, owner rejection, idempotent
