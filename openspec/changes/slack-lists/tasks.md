## 1. Live shape check

- [ ] 1.1 Get from the coordinator a captured `files.info` response for one real List (`list_metadata.schema`, select `options.choices`, `access`) and one `slackLists.items.list` page, and save them redacted as test fixtures for §4 and §5. If a shape contradicts the facts in `design.md`'s Context, stop and correct `design.md` before starting §4; §2 and §3 do not depend on this

## 2. Config gate

- [x] 2.1 Add `listsZod` to `src/configSchemas.ts` (fail-fast: `mode` enum `off|read|write`, optional `writeRole` enum `member|dev|admin|owner`, unknown keys rejected, errors name the key) and add `lists` to `manifestConfigZod` (a separate hunk from `canvases`)
- [x] 2.2 Wire `lists` into `Config` (`src/config.ts`) and `src/configZod.ts` via `parseOrThrow`
- [x] 2.3 Add the `lists` entry to `src/tools/admin/configSchema.ts` (description says enabling needs manifest re-upload + reinstall)
- [x] 2.4 Unit tests for `listsZod`: absent, each mode, default `writeRole`, invalid mode, invalid role, unknown key

## 3. Scopes

- [x] 3.1 `src/slack/requiredScopes.ts`: add `lists:read` / `lists:write` to `UntypedBotScope`, `lists` to `ManifestFeatures` / `ManifestFeatureSource` / `manifestFeatures`, and the mode-driven scopes in `requiredBotScopes` (a separate hunk from other projects' edits)
- [x] 3.2 Tests: read adds only `lists:read`; write adds both; off/absent adds none; events unchanged
- [x] 3.3 Manifest generator test: invalid `lists.mode` fails naming the key

## 4. Cell translation

- [x] 4.0 Move `toRichText` from `src/streaming/taskCardProjection.ts` into `src/slack/richText.ts` (with a test) and import it at the existing call site
- [x] 4.1 Create `src/slack/listCells.ts`: column resolution (name case-insensitive, then key; unknown and ambiguous reported), `toCells(schema, fields)` with the D4 coercion table returning cells or every problem, `fromFields(schema, fields)` with select labels and the `text` fallback, `writableColumnTypes`
- [x] 4.2 Unit tests: every writable type (valid and invalid value), `todo_*` aliases, select by label and by value, multi-select, mention stripping for users and channels, rating above max, read-only type, unknown column, ambiguous column, several problems reported together, `fromFields` for each modelled type and an unmodelled one

## 5. Slack List layer

- [x] 5.0 Once `slack-canvases` is committed: move the Slack file-id pattern, `isSlackHost` and `isDirectConversation` from `src/slack/canvases.ts` into `src/slack/fileRef.ts` (with tests), and update `canvases.ts`, `createCanvas.ts` and their tests to import from it
- [x] 5.1 Create `src/slack/listRef.ts`: `parseListRef` (id, `/lists/<team>/<file>` URL, optional `record_id`). Create `src/slack/lists.ts`: `getListInfo` (`files.info` → title, schema, permalink, zod-parsed), `listItems`, `getItem`, `createItem`, `updateCells`, `deleteItems`, `createList`, `shareListWithChannel`, `listErrorMessage`
- [x] 5.2 Unit tests with `createSlackClientMock()`: each call's arguments, zod handling of malformed and unknown-cell responses, ref parsing (id, URL, URL with record id, rejects a message permalink), every mapped error code

## 6. Read tools

- [x] 6.1 `src/tools/query/readList.ts`: parse ref → `checkFileAccess` → schema + one page (`limit` default 50, max 100; `cursor`; `archived`) → translated items, capped at 100,000 characters at an item boundary with a note (defaults applied in the handler, never with zod `.default()`)
- [x] 6.2 `src/tools/query/getListItem.ts`: parse ref (item id from the argument or the URL's `record_id`) → `checkFileAccess` → one translated item
- [x] 6.3 Unit tests for both, mocking `src/slack/lists.ts` and `requesterAccess` at the boundary: every scenario under "Reading a List" and "List reference parsing" in `specs/slack-lists/spec.md`, including denial makes no List call, paging, `archived: true`, truncation, item id from the URL's `record_id`, missing item id

## 7. Write tools

- [x] 7.1 `src/tools/actions/addListItems.ts`: parse ref → `checkFileAccess` → refuse on `botAccess: "read"` → cap 20 → translate all → create sequentially, stopping at the first failure and reporting created ids
- [x] 7.2 `src/tools/actions/updateListItems.ts`: same gate → translate all → refuse above 100 cells → one `updateCells` call
- [x] 7.3 `src/tools/actions/createList.ts`: validate columns (first is text, types writable, names unique case-insensitively; no zod `.default()` on `todo_mode`) → create → share to the session channel at write access unless `isDirectConversation` (warning on failure) → `recordGrant` → id + permalink
- [x] 7.4 Unit tests for each: every scenario in `specs/slack-lists/spec.md`, translation problems write nothing, mid-batch failure report, share skipped in a DM, share failure warning

## 8. Delete with confirmation

- [x] 8.1 `src/tools/types.ts`: add the `list_items_delete` staged intent (`listId`, `itemIds`, per-item labels) to `StagedIntentType` / `StagedIntent`; mark it never auto-executed in `src/slack/handlers/autoExecute.ts`
- [x] 8.2 `src/tools/actions/deleteListItems.ts`: parse ref → `checkFileAccess` → refuse on `botAccess: "read"` → cap 50 → read the items' primary-column labels → stage the intent
- [x] 8.3 `src/slack/blocks.ts` + `src/tools/presentation/submitResponse/actions.ts`: render the confirm button for the intent; strings through `t()` with keys in `src/i18n/strings/en.ts` and `fr.ts`
- [x] 8.4 `src/slack/handlers/listItemsDeleteAction.ts`, registered in `src/slack/app.ts`: on click, check the clicker's role against `writeRole` and `checkFileAccess`, call `deleteItems`, update the message with the outcome
- [x] 8.5 Unit tests: tool stages and deletes nothing, refuses 51 items without staging, refuses on `botAccess: "read"` without staging; handler deletes on a valid click, refuses a clicker below `writeRole`, refuses a clicker denied by the access check, reports a Slack failure; i18n parity passes

## 9. Registration

- [x] 9.1 `src/tools/server.ts`: read tools when mode ≠ off and a Slack client exists; write tools when mode is write and `meetsMinimumRole(role, writeRole ?? "dev")` (a separate hunk from `canvases`); registration tests per mode/role
- [x] 9.2 Open the `lists: { mode: "write" }` gate in `src/tools/servedToolSchemas.integration.test.ts` and confirm the six tools list and validate

## 10. Docs and verification

- [x] 10.1 `CLAUDE.md`: a "Slack Lists" section (config, modes, tools, cell translation, access check, delete confirmation, manifest re-upload + reinstall, paid plan)
- [x] 10.2 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on changed files, `npm test`
- [x] 10.3 `openspec validate slack-lists --strict`
- [x] 10.4 ~~`graphify update .`~~ — dropped: graphify is being removed from the repo (remove-graphify)
