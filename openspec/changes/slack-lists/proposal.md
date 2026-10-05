## Why

Teams track work in Slack Lists (task boards, intake queues, bug triage), and Clack cannot open them: a List link in a question is opaque to it, and "add this to the backlog List" is impossible. Slack exposes Lists to apps through `lists:read` / `lists:write`, `@slack/web-api` 8.1.1 types the whole `slackLists.*` surface, and the requester-access check (`src/slack/requesterAccess.ts`) makes it safe to open a file on someone's behalf.

## What Changes

- Add a top-level `lists` config block: `{ mode: "off" | "read" | "write", writeRole?: UserRole }`, fail-fast zod, default `mode: "off"` (fully inert), `writeRole` default `"dev"`. Same shape as `canvases`.
- The manifest follows the mode: `read` adds the `lists:read` bot scope, `write` adds `lists:read` and `lists:write`. No bot events. Enabling, or moving from `read` to `write`, requires re-uploading the manifest AND reinstalling the app; the scope drift check reports a stale token.
- `read` mode registers, for every role:
  - `read_list` — takes a List id or URL, runs `checkFileAccess`, and returns the List's columns (name, type, select options) and a page of items with each cell rendered by column name.
  - `get_list_item` — one item by id.
- `write` mode also registers, for roles at or above `writeRole`:
  - `add_list_items` — creates items from `{column name → value}` pairs.
  - `update_list_items` — sets cells on existing items from `{column name → value}` pairs.
  - `delete_list_items` — stages a deletion the requester confirms with a button; nothing is deleted before the click.
  - `create_list` — creates a List from a name and column definitions. Outside a DM or group DM it shares the List with the session's channel at write access; it records a session grant and returns the List id and permalink.
- A translation layer resolves column names against the List's schema and coerces plain values into Slack's typed cells (a select label into its option id, text into rich text, a `<@U…>` mention into a user cell), and refuses unknown columns, unknown options and column types that cannot be written.
- `read` mode never registers a write tool, so Clack cannot write any List.
- No tool deletes a List, renames one, changes its columns, or changes who can access one beyond the channel share `create_list` performs at creation.

## Capabilities

### New Capabilities

- `slack-lists`: the `lists` config gate, the cell translation layer, and the `read_list`, `get_list_item`, `add_list_items`, `update_list_items`, `delete_list_items` and `create_list` tools.

### Modified Capabilities

- `manifest-generation`: the `lists` mode adds the List scopes.

## Impact

- New: `src/slack/fileRef.ts` and `src/slack/richText.ts` (helpers moved out of `src/slack/canvases.ts` and `src/streaming/taskCardProjection.ts` so Lists share them), `src/slack/lists.ts` (Slack calls, response parsing, error mapping), `src/slack/listCells.ts` (schema ⇄ cell translation), `src/tools/query/readList.ts`, `src/tools/query/getListItem.ts`, `src/tools/actions/addListItems.ts`, `src/tools/actions/updateListItems.ts`, `src/tools/actions/deleteListItems.ts`, `src/tools/actions/createList.ts`, `src/slack/handlers/listItemsDeleteAction.ts`, each with tests.
- Changed: `src/configSchemas.ts` (`listsZod`, `manifestConfigZod`), `src/configZod.ts`, `src/config.ts`, `src/tools/admin/configSchema.ts`, `src/slack/requiredScopes.ts`, `src/tools/server.ts`, `src/tools/types.ts` (a staged intent type for the delete confirmation), `src/slack/blocks.ts`, `src/tools/presentation/submitResponse/actions.ts`, `src/slack/handlers/autoExecute.ts`, `src/slack/app.ts`, `src/i18n/strings/en.ts` / `fr.ts` (button and confirmation strings), `src/tools/servedToolSchemas.integration.test.ts` (gate opened), `CLAUDE.md`.
- Slack API: `files.info`, `slackLists.items.list`, `slackLists.items.info`, `slackLists.items.create`, `slackLists.items.update`, `slackLists.items.deleteMultiple`, `slackLists.create`, `slackLists.access.set`. All typed by `@slack/web-api` 8.1.1; the response types are incomplete, so responses are parsed with zod.
- Shared files: `slack-canvases` adds parallel blocks to the same config schemas, `requiredScopes.ts`, `tools/server.ts` and `CLAUDE.md`; this change's hunks stay separate from them. `src/slack/requesterAccess.ts` is not changed.
- Plans: Lists need a paid Slack plan; on a free plan the tools report Slack's plan error.
