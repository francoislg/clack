## 1. Storage layer — partial-patch `updateRule`

- [x] 1.1 Change `updateRule` in `src/autoRespond.ts` to accept `(ruleId: string, patch: Partial<Omit<AutoRespondRule, 'id' | 'enabled'>>)` — omitted keys preserve existing values, empty string/array on optional fields clears them
- [x] 1.2 Update the Home Tab edit submission handler in `src/slack/handlers/homeTab.ts` to pass a single patch object to `updateRule` (preserves today's behavior of full-rule replacement)
- [x] 1.3 Add/extend unit tests in `src/autoRespond` tests to cover: omitted field preserved, empty string clears `extraContext`/`preAnalysisContext`, empty array clears `keywords`/`userFilters`, unknown ID returns null

## 2. Query tool — `list_auto_respond_rules`

- [x] 2.1 Create `src/tools/query/listAutoRespondRules.ts` exporting `createListAutoRespondRulesTool(ctx)` — no arguments, returns all rules from `getRules()`
- [x] 2.2 Add unit tests in `src/tools/query/listAutoRespondRules.test.ts` — empty store returns empty, populated store returns all fields set

## 3. Action tool — `add_auto_respond_rule`

- [x] 3.1 Create `src/tools/actions/addAutoRespondRule.ts` exporting `createAddAutoRespondRuleTool(ctx)` — required `channels`, optional `userFilters`/`keywords`/`extraContext`/`preAnalysisContext`
- [x] 3.2 Resolve each `channels[]` entry via `resolveChannelId` before persisting; on any resolution failure, return an error and do not mutate the store
- [x] 3.3 Reject empty `channels` arrays with a clear error
- [x] 3.4 Add unit tests in `src/tools/actions/addAutoRespondRule.test.ts` — happy path (name → ID), mixed inputs, resolution failure, empty channels, all-fields-set

## 4. Action tool — `update_auto_respond_rule`

- [x] 4.1 Create `src/tools/actions/updateAutoRespondRule.ts` exporting `createUpdateAutoRespondRuleTool(ctx)` — required `id`, all other fields optional
- [x] 4.2 When `channels` is supplied, resolve each entry via `resolveChannelId`; omit to preserve
- [x] 4.3 Pass through to the new partial-patch `updateRule`; return `{ ok: true, id }` on success, error on unknown ID
- [x] 4.4 Add unit tests in `src/tools/actions/updateAutoRespondRule.test.ts` — partial patch preserves omitted fields, empty string clears, empty array clears, channel re-resolution, unknown ID errors

## 5. Action tool — `toggle_auto_respond_rule`

- [x] 5.1 Create `src/tools/actions/toggleAutoRespondRule.ts` exporting `createToggleAutoRespondRuleTool(ctx)` — required `id`
- [x] 5.2 Wrap `toggleRule` from `src/autoRespond.ts`; return `{ ok: true, id, enabled }` with post-toggle state
- [x] 5.3 Return error on unknown ID
- [x] 5.4 Add unit tests in `src/tools/actions/toggleAutoRespondRule.test.ts` — enabled→disabled, disabled→enabled, unknown ID

## 6. Action tool — `delete_auto_respond_rule`

- [x] 6.1 Create `src/tools/actions/deleteAutoRespondRule.ts` exporting `createDeleteAutoRespondRuleTool(ctx)` — required `id`
- [x] 6.2 Wrap `deleteRule`; return `{ ok: true, id }` on success; error on unknown ID (when `deleteRule` returns `false`)
- [x] 6.3 Add unit tests in `src/tools/actions/deleteAutoRespondRule.test.ts` — happy path, unknown ID

## 7. Server registration

- [x] 7.1 Import the five new tool factories in `src/tools/server.ts`
- [x] 7.2 Register all five inside a single `if (canEditConfig(ctx.role) && ctx.slackClient) { … }` block in `buildQueryTools`
- [x] 7.3 Place the block alongside other admin-gated registrations (e.g., near the existing `canEditConfig` block around `list_config_files`)
- [x] 7.4 Update `src/tools/server.test.ts` to assert: admin sees all five tools, non-admin sees none, missing Slack client hides all five

## 8. Verification

- [x] 8.1 Run `npx tsc` — zero type errors
- [x] 8.2 Run `npm test` — all tests pass including existing Home Tab auto-respond tests (prove `updateRule` refactor didn't break the modal submission path)
- [x] 8.3 Run `openspec validate add-auto-respond-mcp-tools --strict` — clean
- [x] 8.4 Manual sanity check of tool descriptions — each includes guidance to ask clarifying questions on ambiguous asks (mirror `create_scheduled_message`)
