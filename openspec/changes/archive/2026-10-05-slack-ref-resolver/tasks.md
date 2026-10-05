## 1. Live facts (coordinator, running app)

- [x] 1.1 Canvas facts from a live `files.info` on `F09SBU6D3FV` (a canvas): `filetype` "quip", `pretty_type` "Canvas", mimetype `application/vnd.slack-docs`, `mode` "quip"
- [x] 1.1b List facts from a live `files.info` on `F0BSE12AF7Z`: `filetype` "list", `pretty_type` "List", mimetype `application/vnd.slack-list`, `mode` "list"
- [x] 1.2 Attached-canvas shape from production (DM D0EXAMPLE04): a canvas link in a message appears as an unfurl `attachments[]` entry and as a `files[]` entry (`name` "Infrastructure_TODO", mimetype `application/vnd.slack-docs`). The `files[]` entry can be missing from the triggering event, because Slack adds it on unfurl. An attached List is assumed to take the same shape (`application/vnd.slack-list`).

## 2. Access facts

- [x] 2.1 `src/slack/requesterAccess.ts`:
  - extend `fileEvidenceZod` with `filetype`, `pretty_type`, `name`, `title`, `mimetype`, `size` and `url_private` (each `.optional().catch(undefined)`);
  - return them as `facts` on an allowance;
  - keep denials reason-only.
- [x] 2.2 Tests: an allowance carries the facts, a denial carries none, and a malformed field degrades to absent

## 3. Resolver and kind table

- [x] 3.1 `src/slack/slackRefs.ts`:
  - `parseSlackRefs(text)` and `parseSlackRef(ref)`, covering bare ids on word boundaries, `/files/`, `/lists/` (with `record_id`), `/docs/`, `/canvas/`, `/archives/…/p…` (with `thread_ts`), and `<url|label>` markup;
  - dedupe, and cap at 10 per input with a log line.
- [x] 3.2 Kind table, `SlackRefKind` and `SlackRef` types:
  - entries `message`, `list`, `canvas`, `image`, `document`, `file`, in that order;
  - `reader(gates)` falls through when the reader isn't registered;
  - catch-all label from `pretty_type`, then mimetype;
  - `matches` for `list` and `canvas` pinned to the task 1 values.
- [x] 3.3 `resolveSlackRefs(req, { text?, files? })`:
  - attached files are classified from their own facts;
  - text file refs go through `checkFileAccess` (`facts` on allow, an inaccessible ref on deny);
  - permalinks are parse-only.
- [x] 3.4 Unit tests (mock `checkFileAccess`):
  - every parse form and the non-matches (`FAQ`, `F1`);
  - each kind, the fall-through with lists/canvases off, the `Workflow` catch-all and the mimetype label without `pretty_type`;
  - a ref yielded by the current message and an earlier source stays marked current-message;
  - an inaccessible ref carries no facts;
  - the cap and the dedupe.
- [x] 3.5 Point `parseListRef` (`listRef.ts`), `parseCanvasRef` (`canvases.ts`) and `parseSlackMessageUrl` (`fetchSlackMessage.ts`) at `parseSlackRef`. Remove their own URL rules, and update their callers' imports (no re-exports).

## 4. One attachment list

- [x] 4.1 `src/slack/slackFileBase.ts` / `fileExtractor.ts`:
  - a `slackFileZod` schema replaces the hand-rolled guards in `extractSlackFiles`;
  - `extractAttachments` returns one `files` list of every kind, with `filetype` / `pretty_type` when present;
  - the `too_large` marking is kept, and the cap stays 10 images plus 10 other files per message (not 10 total).
- [x] 4.2 Replace `imageFiles` with `files` at every declaration and spread site:
  - `src/slack/handlers/core.ts`: `ProcessMessageParams`, `ProcessingContext`, `buildTriggerFromParams`'s parameter type, and the spreads that pass `imageFiles` on;
  - `src/sessions.ts`: `ThreadMessage`, the `reactions` / `mentions` / `directMessages` / `autoRespond` `SessionTrigger` variants, and the trigger builders;
  - drop `imageFiles` from new writes;
  - the session and thread-context readers merge a legacy `imageFiles` into `files` (permissive);
  - `findSessionTranscript` reads the merged list.
- [x] 4.3 Handlers `assistant`, `classicDm`, `mention`, `newQuery` and `autoRespond`: derive "has images" and `buildImageOnlyPreAnalysisText` input by filtering `files` with the kind table's `isImageFile` (`SlackFileBase` carries no kind field).
- [x] 4.4 Tests: extraction (each kind in one list, malformed skipped, oversized marked), the legacy `imageFiles` merge, and the image-only handler paths.
- [x] 4.5 Tell the coordinator, for whoever picks up `sessions-loader-onto-zod`, that its trigger and thread-message schemas must model `files` plus the legacy `imageFiles` (design D9). Don't edit that change's artifacts from here.

## 5. One registry and one prompt section

- [x] 5.1 Replace `availableImages` / `availableFiles` with `availableRefs: Map<string, SlackRef>` in:
  - `src/tools/types.ts`, `src/tools/context.ts`;
  - `src/claude/index.ts`, `src/claude/promptBuilder.ts`;
  - `src/tools/server.ts`, where `view_slack_file` registers when `availableRefs` is non-empty or a Slack client exists.
- [x] 5.2 `src/slack/handlers/core.ts`: build `availableRefs` with `resolveSlackRefs`, replacing the merge loops at `core.ts:776-791`. Skip text for `scheduled` triggers. Sources:
  - the current message (`params.messageText` + `params.files`, marked `fromCurrentMessage`), so a follow-up's text is resolved too;
  - the session's original trigger;
  - every thread-context message.
- [x] 5.2b Queued follow-ups (`core.ts` ~669-707, the `existingRun.sendUpdate` early return):
  - resolve the queued message's text and `files` with `resolveSlackRefs`;
  - add them to the live run's `availableRefs` as current-message refs, reaching the map through the active-run record;
  - append the `[referenced: …]` tag to the pushed text;
  - test: an image attached to a message queued onto a live run is registered and named in the pushed text.
- [x] 5.3 `src/claude/promptBuilder.ts`:
  - REFERENCED SLACK ITEMS section from the kind table, with the `too_large` and inaccessible lines;
  - current-message refs first under "named in this message", the rest under "earlier in the conversation";
  - the open-before-answering rule applies only to current-message refs of a `mustOpen` kind;
  - one `[referenced: …]` thread-context tag replacing the two attachment tags.
- [x] 5.4 `fetch_slack_message` / `fetch_channel_messages`:
  - resolve returned messages' text and files into `availableRefs`;
  - `messageBuilder.ts` tool output uses one `files` array (`file_id`, `name`, `kind`, `reader`) and drops `images`.
- [x] 5.5 Tests:
  - prompt section per kind;
  - section absent when empty;
  - only current-message `mustOpen` refs forced, and an earlier-thread image not forced;
  - fetch tools register refs found in text and files;
  - a scheduled trigger resolves its attachments but not its prompt text;
  - `view_slack_file` is registered with a non-empty registry and no Slack client, with a Slack client and an empty registry, and not with neither.
- [x] 5.6 Regression tests from DM D0EXAMPLE04:
  - the first run, whose event has text `F09SBU6D3FV` and no `files[]`, registers the canvas with `read_canvas`;
  - the follow-up "Can you read this list: F0BSE12AF7Z" in a thread whose first message attached the canvas lists the List first with `read_list`, lists the canvas under "earlier in the conversation", and forces neither.

## 6. Readers resolve through the resolver

- [x] 6.1 A shared helper `resolveRefForReader(ctx, ref, expectedKind)`:
  - a registry hit is used as-is for `view_slack_file` and `fetch_slack_message`; the List and canvas tools still call `checkFileAccess` on every call and use the hit only for the kind (design D6);
  - otherwise it resolves with the access check and registers the result;
  - a wrong kind returns the redirect error;
  - an inaccessible ref returns the access-denied message.
- [x] 6.2 Use it in `view_slack_file`, `read_list` / `get_list_item` (via `openList`), `read_canvas`, `edit_canvas` (`src/tools/actions/editCanvas.ts`) and `fetch_slack_message`, keeping their write-side checks unchanged. `edit_canvas` likewise keeps calling `checkFileAccess` for its `botAccess` refusal on every call. `openList` with the `"write"` intent never takes the registry shortcut: it keeps calling `checkFileAccess` and refusing on `botAccess: "read"`.
- [x] 6.3 Tests per reader:
  - a registry hit makes no call for `view_slack_file` and `fetch_slack_message`;
  - a registered canvas or List still gets `checkFileAccess` before its content call;
  - an unregistered allowed ref is resolved and read;
  - an unregistered denied ref is refused without a content call;
  - a wrong kind gets the redirect naming the tool;
  - a write through `openList` on a List already in the registry still calls `checkFileAccess` and is refused when the bot's access is `read`.

## 7. One view tool

- [x] 7.1 `view_slack_file` gains the image tier: cached base64 becomes an `image` block, download on a miss, and the `too_large` notice. The download helper moves from `viewSlackImage.ts` into `viewSlackFile.ts`.
- [x] 7.2 Remove `view_slack_image`: `viewSlackImage.ts` (+ test), the server registration, `toolNameValidator.ts`, `data/default_configuration/tool_mapping/clack.json`, and the assertions naming it in `src/streaming/toolLabels.test.ts` and `src/claude/promptBuilder.test.ts`
- [x] 7.3 Tests: image open on a cache hit and a miss, an oversized image, a download failure, and the existing pdf/text/unsupported tiers

## 8. Close out slack-lists

- [x] 8.1 `src/slack/testListApi.ts`: a real-shape fixture from List `F0BSE12AF7Z`:
  - the text primary column;
  - `todo_completed` / `todo_assignee` / `todo_due_date` columns with fixed ids `Col00`/`Col01`/`Col02`;
  - a custom text column whose `key` differs from its `id`.

  Tests in `lists.test.ts` / `listCells.test.ts`:
  - items with omitted empty cells, `{ value: null, text: "", rich_text: [] }` and `{ value: false, checkbox: false }` fields parse and render;
  - a write to the custom column uses its `id`, not its `key`.

- [x] 8.2 In `openspec/changes/slack-lists/specs/slack-lists/spec.md`, reword "List reference parsing": a non-List file reference gets the kind redirect naming its reader tool, and a value that is no Slack reference is refused without a Slack call. Update its "Not a List reference" scenario to match.
- [x] 8.3 Check off slack-lists task 1.1 (live shapes verified on `F0BSE12AF7Z`), then `/opsx:archive slack-lists` before archiving this change, so the slack-lists spec exists when this change's deltas sync and both archives land in this change's commit

## 9. Docs and verification

- [x] 9.1 `CLAUDE.md`: a "Slack references" section (resolver, kind table and catch-all, registry, prompt section, readers' redirects, adding a kind), and update the canvases and Lists sections to point at it
- [x] 9.2 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on the changed files, `npm test`, and `src/tools/servedToolSchemas.integration.test.ts`
- [x] 9.3 `openspec validate slack-ref-resolver --strict`
- [ ] 9.4 Live check through the coordinator: DM Clack the bare canvas id `F09SBU6D3FV`, then a List link and an image, and confirm each reaches the right reader on the first call
