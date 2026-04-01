## Context

Roles in Clack follow a strict hierarchy: `owner > admin > dev > member`. A user is in exactly one tier at a time (except `owner` who is implicitly admin+). The current code models this as separate lists (`admins[]`, `devs[]`) with four independent add/remove functions that each handle cascading partially. The Home Tab UI calls these functions directly.

## Goals / Non-Goals

**Goals:**
- Unified `setRole(userId, role)` function in `roles.ts` that replaces four functions
- `admin_set_role` MCP tool so admins can manage roles in conversation
- Home Tab handlers refactored to use `setRole`

**Non-Goals:**
- No owner management — transferring ownership has its own flow and is not part of this tool
- No bulk role operations — one user at a time
- No changes to the role hierarchy itself

## Decisions

### 1. Unified setRole function

Replace `addAdmin`, `removeAdmin`, `addDev`, `removeDev` with:

```typescript
setRole(userId: string, role: "admin" | "dev" | "member"): Promise<{ success: boolean; error?: string }>
```

Cascading logic:
- `setRole(id, "admin")` → add to admins, remove from devs
- `setRole(id, "dev")` → add to devs, remove from admins
- `setRole(id, "member")` → remove from both admins and devs

Owner protection: setting role for the owner returns an error (owner can't be demoted via this function).

Already-at-role: if the user is already at the target role, return `{ success: true }` (idempotent, not an error).

### 2. Keep old functions as thin wrappers (temporarily)

To avoid a big-bang refactor, keep `addAdmin`/`removeAdmin`/`addDev`/`removeDev` as thin wrappers around `setRole` during this change. They can be removed in a follow-up cleanup once all call sites are migrated.

**Alternative considered**: Delete them immediately. Rejected because the Home Tab handlers have a generic `registerAddRoleHandlers`/`registerRemoveRoleHandlers` pattern that passes these functions as callbacks. Refactoring that pattern adds scope.

Actually — the Home Tab handlers can simply call `setRole(userId, "admin")` etc. in the callbacks. The wrapper approach is unnecessary complexity. Let's just migrate the call sites and remove the old functions.

### 3. Tool uses Slack user ID

The `admin_set_role` tool takes a `user` parameter (Slack user ID, e.g., "U0123ABC"). Claude can resolve display names to IDs using the existing `find_user` tool before calling `admin_set_role`. No name resolution inside the role tool itself.

## Risks / Trade-offs

- **[Idempotent set]** → Setting a user to their current role is a no-op success. This matches user expectation ("make alice an admin" when she already is → "done") but differs from the current behavior which returns an error ("User is already an admin").
- **[Home Tab handler refactor]** → The `registerAddRoleHandlers`/`registerRemoveRoleHandlers` pattern currently takes a specific add/remove function as a callback. Switching to `setRole` means the callbacks need to map button action → target role. This is straightforward but touches the test mocks.
