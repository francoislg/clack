## 0. Permissions Module

- [x] 0.1 Create `src/permissions.ts` with role-based permission functions: `canEditConfig(role)`, `canRequestChanges(role)`, `canManageRoles(role)`, `canTransferOwnership(role)`
- [x] 0.2 Add userId-based wrappers: `userCanEditConfig(userId)`, `userCanManageRoles(userId)`
- [x] 0.3 Migrate `src/slack/handlers/homeTab.ts` — replace `isAdmin()` checks with `userCanEditConfig()` (for config edits) and `userCanManageRoles()` (for role management)
- [x] 0.4 Migrate `src/slack/handlers/changeWorkflowHelper.ts` — replace inline role check with `canRequestChanges(role)`
- [x] 0.5 Migrate `src/slack/homeTab.ts` — replace `isAdmin(userId)` / `isDev(userId)` calls with permission functions where appropriate

## 1. Response Parsing

- [x] 1.1 Add `ConfigUpdateInfo` type and `parseConfigUpdate()` function in `src/claude.ts`
- [x] 1.2 Extend `ClaudeResponse` type with `isConfigUpdate` and `configUpdateInfo` fields
- [x] 1.3 Add config update parsing in `askClaude()` response handling, gated on `canEditConfig(options.role)` (after change-request and resume-request checks)

## 2. Instruction Variable

- [x] 2.1 Register `CONFIG_UPDATE_BLOCK` in `src/instructionVariables.ts`
- [x] 2.2 Build `CONFIG_UPDATE_BLOCK` content in `src/claude.ts` `buildSystemPrompt()` — gated on `canEditConfig(role)`, list available config files, read paths, and output format
- [x] 2.3 Add `{CONFIG_UPDATE_BLOCK}` placeholder to `data/default_configuration/admin_instructions.md`

## 3. Pending Updates Store

- [x] 3.1 Create in-memory pending config updates store in `src/configUpdates.ts` — Map keyed by UUID with filename, content, userId, and expiry timestamp
- [x] 3.2 Add `addPendingUpdate()`, `getPendingUpdate()`, `removePendingUpdate()` functions with 5-minute TTL cleanup

## 4. Slack Confirmation Flow

- [x] 4.1 Add `handleConfigUpdate()` in `src/slack/handlers/core.ts` — posts preview message with Apply/Dismiss buttons, stores pending update
- [x] 4.2 Wire `handleConfigUpdate()` into `handleSpecialResponses()` for `isConfigUpdate` responses
- [x] 4.3 Register `apply_config_update` action handler — verifies `userCanEditConfig()`, validates filename against `listInstructionFiles()`, writes via `writeInstructionFile()`, confirms
- [x] 4.4 Register `dismiss_config_update` action handler — removes pending update, updates message

## 5. Verification

- [x] 5.1 Run `npm run build` to verify no type errors
