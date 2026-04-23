## Context

Auto-respond rules are global, admin-managed configuration that controls when Clack unprompted-replies in a channel. Rules live in `data/state/auto-respond.json` and are owned by `src/autoRespond.ts`, which exposes `getRules`, `addRule`, `updateRule`, `toggleRule`, `deleteRule`, `getRule`, and `findMatchingRule`. The only existing management surface is the Home Tab — `src/slack/handlers/homeTab.ts` wires modals and buttons (`ai_add_rule`, `ai_edit_rule`, `ai_toggle_rule`, `ai_delete_rule`) to these CRUD functions under a `userCanManageRoles` gate.

Scheduled messages solve the structurally-identical problem (admin-adjacent CRUD over a JSON-backed config) via five MCP tools at `src/tools/{query,actions}/{create,list,update,cancel}ScheduledMessage.ts`, registered together at `src/tools/server.ts:390`. They write directly to the store without intent staging and enforce permissions inside each tool.

Two smaller constraints:
- `updateRule` in `src/autoRespond.ts:116` takes the full set of optional fields and *unsets* any that are missing or empty. A partial-patch caller would accidentally clear `keywords`/`userFilters`/`extraContext`/`preAnalysisContext`.
- Rules store channel *IDs* (e.g. `C0123…`), but chat users say names (`#engineering`). Input must be normalized.

## Goals / Non-Goals

**Goals:**
- Admins can list, add, update, toggle, and delete auto-respond rules entirely from chat.
- Same permission model, same store, same validation surface as the Home Tab — no drift.
- `updateRule` accepts partial patches; omitted fields are preserved.
- Input channels accept names or IDs; storage continues to hold IDs.
- Tool registrations and schemas follow the scheduled-messages idiom so this is recognizable to anyone who already knows that code.

**Non-Goals:**
- No Home Tab changes. Existing buttons, modals, and handlers stay as-is.
- No new role or permission level; reuse `canEditConfig`.
- No intent-staging / button-confirmation flow. Direct mutation matches the scheduled-messages precedent.
- No singular `get_auto_respond_rule`. `list_` covers it.
- No bulk operations (e.g. "disable all rules in #foo"). Per-rule tools only.
- No changes to `AutoRespondRule` shape, `data/state/auto-respond.json` format, or matching logic (`findMatchingRule`).

## Decisions

### Direct mutation, not staged intents
Scheduled-messages is the closer analogue than `propose_config_update`: both are structured CRUD over a JSON config, both are admin-adjacent, both benefit from fast round-trips. Staging-and-button would double the friction without catching a different class of mistake than schedules already tolerate. Rejected: staged-intent pattern.

### Single admin gate at registration
Register all five tools inside one `if (canEditConfig(ctx.role) && ctx.slackClient)` block in `src/tools/server.ts`. Non-admins never see the tools. This contrasts with scheduled-messages, which registers tools for everyone and checks ownership per-call — but auto-respond rules have no ownership concept (global admin-only), so a simpler gate is correct. Rejected: per-tool checks inside each handler (unnecessary boilerplate).

### Partial-patch `updateRule`
Change the signature of `updateRule` in `src/autoRespond.ts` from:
```
updateRule(id, channels, userFilters?, keywords?, extraContext?, preAnalysisContext?)
```
to:
```
updateRule(id, patch: Partial<Omit<AutoRespondRule, 'id' | 'enabled'>>)
```
Fields absent from `patch` are preserved. Fields present as `null` or `[]` explicitly clear. Matches `updateJob` in `src/cronJobs.ts:198`. The Home Tab handler is updated to pass a full patch object (equivalent to today's behavior). Rejected: adding a second `patchRule` function — two ways to do the same thing invites drift.

### Channel input normalization
Each tool accepting `channels[]` resolves each entry through `resolveChannelId({ client, userId }, value)` before persisting. Accept `#name`, bare names, IDs, and DM IDs. Reject third-party user IDs (same as scheduled-messages). `list_auto_respond_rules` returns channel IDs as stored; it does not resolve back to names (keep surface small — Claude can narrate if asked).

### Tool descriptions steer Claude toward confirmation on ambiguous asks
Following the `create_scheduled_message` precedent: tool descriptions explicitly instruct Claude to ask clarifying questions when the request is ambiguous (e.g. "add a rule for engineering" — which channel ID? which keywords, if any?). This is our mitigation for the "bot starts spamming a channel" risk without adding a confirmation button.

### Tool naming: drop `propose_` prefix
Scheduled-messages uses `create_`, `update_`, `cancel_`, `list_` — not `propose_`. We follow that. The `propose_` prefix in this repo specifically signals "this stages an intent that becomes a Slack button"; using it for direct mutations would mislead Claude.

## Risks / Trade-offs

- **[Misapplied rule causes bot to spam a channel]** → Tool descriptions steer Claude to ask clarifying questions on ambiguous asks; `list_` is always available to verify before mutating; `toggle_` provides a fast undo; admin-only gate prevents accidental exposure.
- **[`updateRule` signature change breaks the Home Tab path]** → The Home Tab submission handler at `src/slack/handlers/homeTab.ts:802` already has all fields in hand from the modal submission; it's adapted to pass them as a patch object. Covered by existing tests in `src/slack/homeTab.test.ts` plus a new unit test for `updateRule` partial semantics.
- **[Race between Home Tab mutation and chat mutation]** → Same in-process cache serves both. `src/autoRespond.ts` already caches in `cached` and writes through on every mutation. Single-process bot — no real contention. Not addressing further.
- **[Channel resolution failure mid-`channels[]` array]** → Tool fails the whole call with a clear error and does not partially persist. Matches `create_scheduled_message` behavior.
- **[Tool-name typos vs validated tool names]** → Auto-respond rules have a `requiredTools` analogue? No — rules don't invoke tools, so this risk doesn't apply.
