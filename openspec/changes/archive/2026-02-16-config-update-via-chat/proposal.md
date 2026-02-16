## Why

Admins can currently edit instruction files only via the Slack Home Tab modal, which is limited to 3000 characters and provides no context about the file's purpose or current state. When admins try to ask Clack to update configuration files through the conversational interface, Claude correctly identifies the intent but has no mechanism to write to `data/configuration/` — the Q&A flow is intentionally read-only.

Admins should be able to say "update the worktree setup instructions for applauz-monorepo to copy .env" and have Clack draft the update, show a preview, and apply it on confirmation.

## What Changes

- Create a centralized permissions module (`src/permissions.ts`) as a single source of truth for all capability checks (`canEditConfig`, `canRequestChanges`, `canManageRoles`, `canTransferOwnership`) — migrate existing scattered `isAdmin()` / `isDev()` checks
- Add a new `<config-update>` structured output tag that Claude can emit when an admin requests a configuration file change
- Add response parsing for `<config-update>` alongside existing `<change-request>` and `<resume-request>` parsing, gated on `canEditConfig(role)`
- Add a `{CONFIG_UPDATE_BLOCK}` instruction variable for admin/owner users that describes available config files, their paths for reading, and the output format
- Add a Slack confirmation flow: preview the proposed content in-thread with "Apply" / "Dismiss" buttons
- Add an action handler that writes the file via `writeInstructionFile()` on approval, gated on `userCanEditConfig(userId)`
- Register the new variable in the instruction variables registry

## Capabilities

### New Capabilities
- `config-update-via-chat`: Admin ability to update instruction/configuration files through the conversational interface with structured output and confirmation flow

### Modified Capabilities
- `claude-code-integration`: Response parsing gains a new `<config-update>` tag type; `ClaudeResponse` type extended
- `instruction-variables`: New `CONFIG_UPDATE_BLOCK` variable added to the registry
- `user-roles`: Permission checks centralized into `src/permissions.ts`; existing callers migrated

## Impact

- `src/permissions.ts` — New centralized permissions module
- `src/claude.ts` — New `parseConfigUpdate()` function, extended `ClaudeResponse` type, `CONFIG_UPDATE_BLOCK` variable in `buildSystemPrompt()`
- `src/instructionVariables.ts` — New variable registration
- `src/slack/handlers/core.ts` — Handle `isConfigUpdate` in `handleSpecialResponses()`, new action handler for Apply/Dismiss buttons
- `src/slack/handlers/homeTab.ts` — Migrate `isAdmin()` calls to permission functions
- `src/slack/handlers/changeWorkflowHelper.ts` — Migrate inline role check to permission function
- `src/slack/homeTab.ts` — Migrate role checks to permission functions
- `data/default_configuration/admin_instructions.md` — Add `{CONFIG_UPDATE_BLOCK}` placeholder
