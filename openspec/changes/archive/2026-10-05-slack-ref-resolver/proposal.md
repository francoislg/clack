## Why

A user DMed Clack a bare file id (`F09SBU6D3FV`, a canvas). Every Slack file id starts with `F`, and nothing told Claude this one was a canvas, so it guessed "image", called `view_slack_image`, got `Unknown file_id`, and asked the user to re-upload. Lists, canvases, images, PDFs and message permalinks each reach Claude through a different path: three ref parsers (`parseListRef`, `parseCanvasRef`, `parseSlackMessageUrl`), two attachment registries (`availableImages`, `availableFiles`) and a prompt section written by hand per registry. A List or canvas attached to a message is even listed as a plain file for `view_slack_file`. Each new Slack object type adds another path.

## What Changes

- **One resolver for every internal Slack reference.** `resolveSlackRefs` turns a bare file id, a Slack file, List or canvas URL, a message permalink, or a message's `files[]` into typed `SlackRef`s. File refs found in text go through `checkFileAccess`, whose single `files.info` call also yields the file's type, name and size.
- **One kind table.** Each kind (`list`, `canvas`, `image`, `document`, `message`, and a catch-all `file`) declares how it is recognized, which tool reads it, and whether it must be opened before answering. The prompt section, tool hints and wrong-tool redirects all derive from it. A Slack object type no entry recognizes falls to `file`, labelled with Slack's own `pretty_type` and read by `view_slack_file`. Supporting a type properly is one table entry plus its reader.
- **One registry per run.** `availableRefs` replaces `availableImages` and `availableFiles`. It is filled from the trigger message's text and files, the thread context, and messages fetched mid-run.
- **One prompt section.** The section is renamed from "ATTACHED FILES" to "REFERENCED SLACK ITEMS" and lists every registered ref with its kind and reader. Images and documents must be opened before answering; Lists, canvases and messages are read on demand.
- **Every reader resolves through the resolver.** `view_slack_file`, `read_list`, `get_list_item`, `read_canvas`, `edit_canvas` and `fetch_slack_message` take any reference. A registry hit gives the kind at once, and file views cost no call; List and canvas tools still check access on every call. An id that isn't registered is resolved on the spot, with its access check. A ref of another kind gets a redirect naming the right tool ("F… is a Slack List: use read_list").
- **BREAKING (Claude-facing tool):** `view_slack_image` is removed. `view_slack_file` opens images too.
- **One attachment list.** A message's attachments are kept as one `files` list of every kind; persisted sessions that still carry `imageFiles` are read as part of that list. Attachment extraction moves to a zod schema.

## Capabilities

### New Capabilities

- `slack-ref-resolver`: parsing and classifying internal Slack references, the kind table and its fallback, the per-run registry and its prompt section, readers resolving through the resolver, and wrong-kind redirects.

### Modified Capabilities

- `slack-file-attachments`: `view_slack_file` opens images and resolves any file ref, not only registered ones. Extraction keeps every attachment kind in one list, and the prompt section lists items by kind.
- `slack-image-support`: images are extracted into the shared attachment list and opened through `view_slack_file`. Image metadata reaches the prompt through the shared section.
- `clack-tools`: the query context carries `availableRefs` instead of `availableImages`, `fetch_slack_message` registers what it returns there, and the `view_slack_image` requirement is removed.
- `session-management`: the session trigger carries one `files` list; a legacy `imageFiles` is still read.
- `slack-canvases`: `read_canvas` and `edit_canvas` resolve their argument through the resolver and redirect a reference of another kind.
- `slack-requester-access`: an allowed file verdict also carries the file's facts from the same `files.info` call.

## Impact

- **New:** `src/slack/slackRefs.ts` (parse, kind table, resolve) and tests.
- **Refactored onto the resolver:**
  - `src/slack/fileExtractor.ts`, `src/slack/slackFileBase.ts`;
  - `src/slack/listRef.ts`, `src/slack/canvases.ts` (`parseCanvasRef`);
  - `src/tools/query/fetchSlackMessage.ts` (`parseSlackMessageUrl`), `fetchChannelMessages.ts`;
  - `src/tools/query/viewSlackFile.ts`, `src/tools/listTools.ts`, `src/tools/query/readCanvas.ts`, `src/tools/actions/editCanvas.ts`;
  - `src/claude/promptBuilder.ts` (attachments section and thread-context tags), `src/claude/index.ts`;
  - `src/tools/context.ts`, `src/tools/types.ts`, `src/tools/server.ts`;
  - `src/slack/handlers/core.ts` and the trigger handlers' `imageFiles` params (`assistant`, `classicDm`, `mention`, `newQuery`, `autoRespond`);
  - `src/slack/messageBuilder.ts`, `src/sessions.ts`, `src/tools/query/findSessionTranscript.ts`.
- **Extended:** `src/slack/requesterAccess.ts`. The file-evidence schema also reads `filetype`, `pretty_type`, `name`, `title`, `mimetype`, `size` and `url_private`, and an allowance returns them.
- **Removed:** `src/tools/query/viewSlackImage.ts`. Its download helper moves next to `viewSlackFile`. The `view_slack_image` entry leaves `toolNameValidator.ts` and `data/default_configuration/tool_mapping/clack.json`.
- **Persisted state:** session `trigger.imageFiles` and thread-context `imageFiles` stay readable (graceful) and are merged into `files`. No migration.
- **Closes `slack-lists`:** a real-shape List fixture and tests from a live List, the slack-lists "List reference parsing" requirement updated to the redirect behavior, and the slack-lists archive in the same commit.
- **Slack API:** at most one `files.info` per distinct file ref found in text, per run, capped per message. No new scopes.
