## Context

Slack Lists are files (`F…` ids, `filetype: "list"`). The bot token sees a List it created, one shared with it, or one shared to a channel it is in. `checkFileAccess(req, fileId)` (`src/slack/requesterAccess.ts`) answers "can the requester see this file?" from `files.info` and reports the bot's own `access` (`read` / `write`). A run with no requester (plugin cron) is allowed only on files shared to a channel the bot may read for it.

Slack API facts the design rests on:

- A List's columns live on its file object: `files.info` → `file.list_metadata.schema[]`, each `{ id, key, name, type, is_primary_column?, options? }`. Select columns carry `options.choices[] { value, label, color }`. There is no `slackLists.info` and no method that enumerates Lists, so Clack acts only on a List someone names.
- `slackLists.items.list { list_id, limit, cursor, archived }` returns `items[]`, each with `fields[] { key, column_id, text, <typed value> }`. `text` is a plain-text rendering of the cell.
- Cells are typed per column: `rich_text` (text columns), `select` (option values, not labels), `user`, `channel`, `date` (`YYYY-MM-DD`), `number`, `checkbox`, `rating`, `email`, `phone`, `link`, `timestamp`, `attachment`, `reference`, `message`.
- `slackLists.items.create { list_id, initial_fields }` creates one item per call. `slackLists.items.update { list_id, cells }` takes cells for any number of rows, each `{ row_id, column_id, <typed value> }`.
- `slackLists.create { name, schema, description_blocks?, todo_mode? }` returns the new List; the creating token owns it. `slackLists.access.set { list_id, access_level, channel_ids | user_ids }` shares it.
- The `slackLists.*` methods are Tier 2 (about 20 calls a minute). No List change events exist.
- Lists need a paid plan.

`@slack/web-api` 8.1.1 types every `slackLists.*` method, but its response types model only a few cell kinds and omit `list_metadata` on `files.info`.

## Goals / Non-Goals

**Goals:** read a List someone links; add and update items by column name; create a List for a new tracker; a `read` mode that cannot write.

**Non-Goals:** deleting, renaming or restructuring a List (columns, views); managing List access beyond the share at creation; finding Lists by name; subtasks; attachments; CSV export (`slackLists.download.*`); reacting to List changes; Lists on free plans.

## Decisions

### D1. One config block with a three-state mode

`lists: { mode: "off" | "read" | "write", writeRole?: "member" | "dev" | "admin" | "owner" }`, fail-fast zod (unknown keys rejected), parsed in `configZod.ts`, added to `manifestConfigZod`. Absent block ≡ `mode: "off"`. `writeRole` defaults to `"dev"`. The shape and semantics match `canvases` exactly, so an operator learns one rule. The role threshold exists because the access check proves the requester can see a List, not that they may edit it: Slack has no API that reads a List's per-user access.

### D2. Scopes in `requiredScopes.ts`

`ManifestFeatures` gains `lists: "off" | "read" | "write"`; `requiredBotScopes` adds `lists:read` for `read` and `lists:read` + `lists:write` for `write`. Both scopes join `UntypedBotScope`. Reading the schema uses `files.info`, covered by the core `files:read` scope. The scope drift check picks the new scopes up with no change of its own.

### D3. Access check before every call

Each tool resolves the List id, then calls `checkFileAccess({ client, userId, role, session }, listId)` and refuses with `FILE_ACCESS_DENIED_MESSAGE` on a denial. Write tools additionally refuse up front when `botAccess === "read"`. An unknown `botAccess` proceeds and lets Slack decide.

### D4. Tools speak column names; the translation layer speaks cells

Claude never sees or sends a `column_id` or a select option id. Tool inputs carry `fields: [{ column, value }]` (an array of pairs: `z.record` cannot be served), where `value` is a string, number, boolean or array of strings. `src/slack/listCells.ts` is pure and holds both directions:

- `toCells(schema, fields)` → typed cells, or a list of problems. A column is matched by name, case-insensitively, then by `key`; no match or several matches is a problem naming the List's columns.
- `fromFields(schema, fields)` → `[{ column, value }]` for reading, with select values mapped back to labels and Slack's `text` rendering as the fallback for every type.

Write coercions by column type:

| Column type                  | Accepted value                          | Cell                                   |
| ---------------------------- | --------------------------------------- | -------------------------------------- |
| `text`                       | string                                  | `rich_text`: one section of plain text |
| `number`                     | number, numeric string                  | `number`                               |
| `checkbox`, `todo_completed` | boolean, `"true"` / `"false"`           | `checkbox`                             |
| `date`, `todo_due_date`      | `YYYY-MM-DD`                            | `date`                                 |
| `select`, `multi_select`     | option label or value (array for multi) | `select` with option values            |
| `user`, `todo_assignee`      | `U…` id or `<@U…>` (array allowed)      | `user`                                 |
| `channel`                    | `C…` id or `<#C…>` (array allowed)      | `channel`                              |
| `rating`                     | integer from 0 to the column's `max`    | `rating`                               |
| `email`, `phone`             | string (array allowed)                  | `email` / `phone`                      |
| `link`                       | URL                                     | `link` with `original_url`             |

Slack types every cell value except `checkbox` and `rich_text` as an array, so a single number, date or rating is sent as a one-element array. The text cell is built with `toRichText`, moved from `src/streaming/taskCardProjection.ts` into `src/slack/richText.ts` so both callers share it.

Every other type (`attachment`, `reference`, `message`, `canvas`, `vote`, `timestamp`, computed columns) is read-only: writing it is a problem naming the column and its type. An unknown select option is a problem listing the column's options. User and channel cells take ids, not names: Claude resolves names with `find_user` / `find_channel` first. Text is written as plain text; markdown formatting inside a cell is out of scope.

A call with any problem writes nothing and returns every problem at once, so Claude fixes the whole payload in one retry.

### D5. Reading

`read_list` returns the List's title, its columns (`name`, `type`, select option labels) and one page of items (`limit` default 50, max 100; `cursor`; `archived`). Each item carries its id and its translated fields. The schema comes from `files.info`, the items from `slackLists.items.list`. The serialized result is capped at 100,000 characters; beyond that the page is cut at an item boundary with a note telling Claude to page with a smaller `limit`. `get_list_item` returns one item through `slackLists.items.info`.

### D6. Adding and updating

`add_list_items` takes up to 20 items. All items are translated first, so a bad value in any item refuses the whole call. Items are then created one `slackLists.items.create` call at a time; a Slack failure stops the loop and the result names the items already created and the one that failed.

`update_list_items` takes `updates: [{ item_id, fields }]`, translates everything, and sends one `slackLists.items.update`. More than 100 cells in total is refused before any call.

### D7. Deleting items needs a click

`delete_list_items` deletes nothing. It finds the named items by paging `slackLists.items.list` (an id that is not in the List is refused), stages a `list_items_delete` intent (List id, item ids, a one-line label per item taken from its primary column) and returns the labels, so the response names what will be deleted above a confirm button. The button comes from the staged-intent path `propose_config_update` uses: the intent is persisted on the session and the button carries only its ref. On the click, the handler re-checks that `lists.mode` is still `"write"`, that the clicking user meets `writeRole` and passes `checkFileAccess`, then claims the intent (`consumeStagedIntent` removes it from the session under the session lock, so of two concurrent clicks only one deletes), calls `slackLists.items.deleteMultiple` and tells the clicker the outcome. The access check uses the staging session's grants only when the clicker is that session's requester; anyone else is judged on their own Slack access. A refused click leaves the intent in place for someone allowed. The item lookup reads at most 10 pages of 100; an id past that is reported as not found within the first 1,000 items. The action's schema has no `auto` field and auto-execution skips the intent type, so a deletion always needs the click. Up to 50 items per intent.

Alternative considered: delete directly, like add and update. Rejected: add and update are visible and correctable in the List; a deleted row is gone.

### D8. Creating a List

`create_list` takes a name, an optional description, `columns: [{ name, type, options? }]` and an optional `todo_mode`. The first column is the primary column and must be `text`. Column types are limited to those D4 can write. Column keys are derived from the names. `options` are select labels; values are derived from them.

After creation, when the session channel is not a DM or group DM (`isDirectConversation`, the check `create_canvas` uses), it calls `slackLists.access.set { access_level: "write", channel_ids: [session.channelId] }` so the people in the conversation can open and work the List. It records a session grant through `recordGrant` (`src/slack/requesterAccess.ts`), which persists it and keeps the in-memory session in step, so later turns pass the access check even in a DM. There is no owner transfer and no per-user grant. A failed share does not fail the tool: the List exists, so the result carries the id, the permalink and a warning. The permalink comes from `files.info`.

Channel access is `write`, where `create_canvas` shares at `read`: a List is a tracker people tick off and reassign in Slack, and a read-only tracker is not usable.

### D9. Slack layer in one module

`src/slack/lists.ts` holds the Slack calls (`getListInfo`, `listItems`, `getItem`, `createItem`, `updateCells`, `deleteItems`, `createList`, `shareListWithChannel`) and `listErrorMessage(error)`, which maps Slack error codes to Claude-facing English: `missing_scope` (manifest re-upload + reinstall), plan errors (paid plan), `list_not_found`, `access_denied` / `no_permission`, `invalid_args`, `ratelimited`. Responses are parsed with permissive zod schemas (unknown cell kinds keep their `text`). Tools take the module through an injected deps object so unit tests mock the boundary.

### D10. List references

Tools accept a List id (`F` + alphanumerics) or a Slack List URL (`https://<ws>.slack.com/lists/<team>/<file>`, with an optional `record_id=Rec…` query). `parseListRef` (`src/slack/listRef.ts`) extracts the `F…` id, and the record id when present, and rejects anything else without a Slack call.

The file-id pattern, the Slack-host check and `isDirectConversation` are the same for canvases and Lists. They move from `src/slack/canvases.ts` into `src/slack/fileRef.ts`, and both `parseCanvasRef` and `parseListRef` build on them. Two more pieces are shared the same way: the Slack-error-code → Claude-facing message builder (`createSlackErrorMessage`, `src/slack/slackErrorMessage.ts`, behind `canvasErrorMessage` and `listErrorMessage`), and the share-with-session-channel and permalink steps of `create_canvas` / `create_list` (`src/tools/fileCreation.ts`).

## Risks / Trade-offs

- **`files.info` schema shape is assumed** → the live spike confirmed `files.info` works on Lists with the bot token; that `list_metadata.schema` and select `choices` have the documented shape is checked against a real List in task 1.1 before the translation layer is written.
- **Non-atomic adds** → items are created one call at a time; a failure mid-batch leaves earlier items in place. The result says which.
- **Rate limit** → a 20-item add is 20 Tier 2 calls plus the schema read. The batch cap keeps one call under the per-minute budget; `ratelimited` has its own message.
- **Directly shared Lists** → a List shared with a person but not a channel may be denied to them by the access check. Accepted: the check denies on missing evidence by design.
- **Lists created in a DM** → not shared with anyone; the requester reaches it only through Clack in that session. Same trade-off as canvases.
- **Schema drift between read and write** → a renamed column or option fails translation cleanly with the current names, rather than writing the wrong cell.

## Migration Plan

No data migration. Operators set `lists.mode`, regenerate and re-upload the manifest, and reinstall the app. Setting `mode: "off"` (or removing the block) unregisters the tools; the scopes stay on the token until the next manifest upload.
