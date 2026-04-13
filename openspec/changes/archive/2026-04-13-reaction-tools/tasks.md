## 1. add_reaction Tool

- [x] 1.1 Create `src/tools/query/addReaction.ts` with `createAddReactionTool(ctx)` — accepts `emoji` + (`channel_id` + `message_ts` or `url`), calls `reactions.add`, handles `already_reacted` as success
- [x] 1.2 Add tests in `src/tools/query/addReaction.test.ts` — success, idempotent (already_reacted), invalid emoji, message not found, invalid URL, missing params, no Slack client

## 2. remove_reaction Tool

- [x] 2.1 Create `src/tools/query/removeReaction.ts` with `createRemoveReactionTool(ctx)` — accepts `emoji` + (`channel_id` + `message_ts` or `url`), calls `reactions.remove`, handles `no_reaction` as success
- [x] 2.2 Add tests in `src/tools/query/removeReaction.test.ts` — success, idempotent (no_reaction), invalid emoji, message not found, channel not found, missing params, no Slack client

## 3. Register Tools

- [x] 3.1 Import and register both tools in `src/tools/server.ts` inside the slackClient block (available to all roles)

## 4. Tool Labels

- [x] 4.1 Add `add_reaction` and `remove_reaction` label entries to `data/default_configuration/tool_mapping/clack.json` with emoji name in the label template (e.g., `"Adding :{emoji}: reaction"`)

## 5. Validation

- [x] 5.1 Run `npx tsc` to verify no type errors
- [x] 5.2 Run full test suite to verify no regressions
