## Context

All ref-based actions (`change`, `update`, `review`, `merge`, `close`) support `auto: true` which lets Claude execute them immediately for clear user directives. The `config_update` action was explicitly excluded from this — it always renders a button. The auto-execute handler in `src/slack/handlers/autoExecute.ts` doesn't handle the `config_update` type. The button-filtering logic in `src/slack/blocks.ts` already strips auto-flagged actions from rendering, so no change is needed there.

The config update write path already exists in `src/slack/handlers/configUpdateAction.ts` — it calls `writeInstructionFile()`. The auto-execute handler just needs to do the same thing inline.

Additionally, `admin_instructions.md` is missing the auto-execute guidance section entirely. The instruction loading system (`src/instructions.ts`) loads `admin_instructions.md` for admin/owner users and `dev_instructions.md` for dev users — they are mutually exclusive. Since only `dev_instructions.md` contains the `### Auto-execute` section, admin/owner users never see auto-execute guidance, causing Claude to always show buttons for them regardless of action type.

## Goals / Non-Goals

**Goals:**
- Add `auto` support to `config_update` so it behaves like all other ref-based actions
- Config updates auto-execute for clear directives, render as buttons for proposals
- Fix admin/owner users missing auto-execute guidance entirely
- Add migration to patch custom instruction overrides

**Non-Goals:**
- Changing the permission model (admin/owner gating stays the same)
- Adding undo/rollback for config updates (out of scope)
- Changing how other action types work

## Decisions

**1. Inline write in auto-execute handler vs extracting shared function**

The button handler in `configUpdateAction.ts` does: resolve intent → write file → post ephemeral confirmation. The auto-execute handler needs: resolve intent → write file → post confirmation in thread.

Decision: Write the file inline in the auto-execute handler using `writeInstructionFile()` directly, same as the button handler. The two paths have different confirmation mechanisms (ephemeral vs thread message) so extracting a shared function adds abstraction for little gain.

**2. Confirmation message for auto-executed config updates**

When auto-executed, post a thread message confirming the update (e.g. "Configuration file `instructions.md` has been updated."). This parallels how auto-executed changes post progress messages.

**3. Permission gating reuses existing `canRequestChanges` check**

The auto-execute handler already gates on `canRequestChanges(role)` which requires dev+. Config updates via button are separately gated on admin/owner in the action handler. For auto-execute, the existing `canRequestChanges` check is sufficient since `propose_config_update` is only registered for admin/owner users — Claude can't even call the tool for non-admins.

## Risks / Trade-offs

**[Risk] Auto-executing a destructive config replacement** → The `propose_config_update` tool already stages the full content, so the intent is validated before execution. The same content that would be written via button click is written via auto-execute. No additional risk.

**[Risk] Claude incorrectly auto-executes an exploratory config discussion** → Mitigated by instruction guidance (same pattern as existing auto-execute guidance for changes). Claude is told: clear directive = auto, exploratory = button.

**4. Migration approach for instruction overrides**

Custom overrides in `data/configuration/` won't pick up default file changes. Migration version 3 patches two files:
- `data/configuration/admin_instructions.md` — add the entire `### Auto-execute` section (with `config_update` in the list)
- `data/configuration/dev_instructions.md` — add `config_update` to the existing auto-execute action list

If a file doesn't exist as an override, skip it — the user will get the updated defaults automatically. Follow the same pattern as migration 002.
