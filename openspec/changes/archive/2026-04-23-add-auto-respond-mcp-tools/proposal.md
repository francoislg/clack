## Why

Auto-respond rules can only be managed through the Home Tab UI today. Admins who live in threads have to context-switch to the app Home every time they want to add, tweak, toggle, or remove a rule. The scheduled-messages capability already demonstrates a clean chat-driven CRUD pattern — auto-respond rules fit that shape exactly and should get the same treatment.

## What Changes

- Add five MCP tools, admin-only, direct-mutation (no intent staging), mirroring the scheduled-messages pattern:
  - `list_auto_respond_rules` — read current rules
  - `add_auto_respond_rule` — create a rule
  - `update_auto_respond_rule` — partial update of an existing rule
  - `toggle_auto_respond_rule` — flip `enabled` on a rule
  - `delete_auto_respond_rule` — remove a rule
- Gate all five tools on `canEditConfig(ctx.role)` and the presence of a Slack client. Non-admins do not see the tools at all.
- Accept channel names, channel IDs, and DM IDs in `channels[]` input; resolve to channel IDs via `resolveChannelId` before persisting.
- Tighten `updateRule` in `src/autoRespond.ts` to a partial-patch signature so omitted fields are preserved rather than cleared (today it treats undefined as "unset"). Matches the shape of `updateJob` in `src/cronJobs.ts`.
- The Home Tab UI keeps working unchanged and writes to the same store — both surfaces share `src/autoRespond.ts`.

## Capabilities

### New Capabilities
- `auto-respond-rule-tools`: MCP tools for admin-driven CRUD of auto-respond rules from chat.

### Modified Capabilities
- `auto-respond`: the `updateRule` storage contract changes from "full replacement of optional fields" to "partial patch". This is a requirement-level change because callers (Home Tab handler, new tools) now rely on omitted-means-preserved semantics.

## Impact

- **Code**: `src/autoRespond.ts` (partial-patch `updateRule`), `src/tools/query/` and `src/tools/actions/` (five new tool files), `src/tools/server.ts` (registration under one admin gate).
- **Callers of `updateRule`**: `src/slack/handlers/homeTab.ts` submits the full rule body today and must be verified to keep working under the new partial-patch semantics (passing all fields is still valid).
- **Data**: none. `AutoRespondRule` shape unchanged, `data/state/auto-respond.json` format unchanged.
- **Permissions**: no new role, no changes to existing gates — reuses `canEditConfig`.
