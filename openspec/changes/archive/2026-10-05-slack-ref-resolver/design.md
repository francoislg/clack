## Context

Internal Slack references reach Claude through several unrelated paths:

| Reference                   | Parsed by                                       | Registered in     | Read by               |
| --------------------------- | ----------------------------------------------- | ----------------- | --------------------- |
| Image attached to a message | `extractAttachments` (`fileExtractor.ts`)       | `availableImages` | `view_slack_image`    |
| Other attached file         | `extractAttachments`                            | `availableFiles`  | `view_slack_file`     |
| List id / URL               | `parseListRef` (`listRef.ts`)                   | none              | `read_list`           |
| Canvas id / URL             | `parseCanvasRef` (`canvases.ts`)                | none              | `read_canvas`         |
| Message permalink           | `parseSlackMessageUrl` (`fetchSlackMessage.ts`) | none              | `fetch_slack_message` |
| Bare `F…` id in text        | nothing                                         | none              | (guessed)             |

Further detail on how the pieces work today:

- **The two registries** are built in `processMessage` (`core.ts:776-791`) from the trigger and the thread context. The fetch tools add to them mid-run (`fetchSlackMessage.ts:111-115`, `fetchChannelMessages.ts:176-180`).
- **The prompt section** is written by hand per registry (`promptBuilder.ts:617-647`). Thread-context lines carry separate `[attached images: …]` and `[attached files: …]` tags (`promptBuilder.ts:252-261`).
- **The view tools** refuse any id their registry doesn't hold.
- **A List or canvas attached to a message** goes into `availableFiles`, because extraction splits "image" from "everything else". It is then listed for `view_slack_file`, which can't read it.
- **`checkFileAccess`** (`requesterAccess.ts:383`) already calls `files.info` on every check, and keeps only the access fields (`fileEvidenceZod`, `:88`).
- **`extractSlackFiles`** (`slackFileBase.ts:37`) validates with hand-rolled guards, against the repo's zod rule.

## Goals / Non-Goals

**Goals:**

- **One parser:** a single parse step for every internal Slack reference.
- **One kind table:** decides what a reference is, which tool reads it, and whether it must be opened.
- **One registry and one prompt section per run.**
- **Readers resolve on demand:** every reader resolves its argument through the resolver, so an unregistered ref is handled, not refused.
- **Safe default for new types:** a Slack object type the table doesn't know is still listed and readable.
- **Fewer code paths and tools than today:** no new parallel path.

**Non-Goals:**

- User and channel mentions (`<@U…>`, `<#C…>`): `transformUserMentions` and the channel tools own them.
- Rewriting reference text inline. The registry and prompt section are the one delivery path.
- A persisted type cache. The access check fetches `files.info` per run anyway (D3).
- New Slack scopes, and new reader tools for types beyond today's.
- Unfurl and attachment previews (`message.attachments`), which are already rendered as text.

## Decisions

### D1. One module, three steps: parse → inspect → classify

`src/slack/slackRefs.ts` exposes `resolveSlackRefs(req, input)`. `input` is `{ text?, files? }`, where `files` is a message's raw `files[]`. It returns `SlackRef[]`.

- **parse:** finds every reference in `text`:
  - bare file ids (the strict `SLACK_FILE_ID_PATTERN` on word boundaries);
  - Slack URLs whose path is `/files/<user>/<F…>`, `/lists/<team>/<F…>`, `/docs/<team>/<F…>`, `/canvas/<F…>` or `/archives/<C…>/p<ts>`.

  Inside Slack's `<url|label>` markup, the URL is what's parsed. The URL-path rules move out of `listRef.ts`, `canvases.ts` and `fetchSlackMessage.ts`, which now call `parseSlackRef(ref)` from this module. The URL helpers (`isSlackHost`, `slackUrlSegments`) already live in `fileRef.ts` and stay there.

- **inspect:** gathers a file's facts.
  - A file from a message's `files[]` already carries them, so no call is made.
  - A file ref from text goes through `checkFileAccess`. That function returns the facts on an allowance (D3).
  - A message permalink needs no call; `fetch_slack_message` checks access when it reads.
- **classify:** gives each ref the first matching kind in the kind table (D2).

At most 10 distinct refs per input are resolved; the rest are dropped with a log line. Duplicate ids collapse.

### D2. The kind table, with a catch-all

```ts
interface RefKind {
  kind: SlackRefKind; // "list" | "canvas" | "image" | "document" | "message" | "file"
  matches(facts: SlackRefFacts): boolean;
  reader(gates: ReaderGates): string | undefined; // tool name, or undefined when that tool isn't registered
  mustOpen: boolean;
}
```

The entries, in order:

| kind       | matches                                                                                     | reader                                                           | mustOpen |
| ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| `message`  | parsed from a permalink                                                                     | `fetch_slack_message`                                            | no       |
| `list`     | `filetype === "list"`                                                                       | `read_list` when `lists.mode !== "off"`, else falls through      | no       |
| `canvas`   | `filetype === "quip"` (live: `pretty_type` "Canvas", mimetype `application/vnd.slack-docs`) | `read_canvas` when `canvases.mode !== "off"`, else falls through | no       |
| `image`    | mimetype in `IMAGE_MIME_TYPES`                                                              | `view_slack_file`                                                | yes      |
| `document` | `classifyMimeType` is `pdf` or `text`                                                       | `view_slack_file`                                                | yes      |
| `file`     | everything                                                                                  | `view_slack_file`                                                | no       |

**Falling through:** a kind whose reader is not registered under the live config lets the ref fall to the next match. So with `lists.mode: "off"`, a List lands on `file` and Claude is never pointed at a missing tool.

**The catch-all:** `file` is labelled with Slack's `pretty_type` (e.g. "Workflow", "Clip"), falling back to the mimetype. Its reader is `view_slack_file`, which returns the file's contents when it can and its metadata otherwise. A future Slack object type therefore reaches Claude as `[Workflow] Onboarding (F…) → view_slack_file`, never as a bare id.

**Adding a dedicated type** is one entry plus its reader tool. The prompt line, the hint, the redirect and the gating all come from the entry.

_Alternative:_ a class per kind with its own render and read methods. Rejected: the entries differ only in data, so a table is enough and is easier to test exhaustively.

### D3. `checkFileAccess` returns the facts it already fetches

`fileEvidenceZod` gains `filetype`, `pretty_type`, `name`, `title`, `mimetype`, `size` and `url_private`, each `.optional().catch(undefined)`. An allowance returns them as `facts`. A denial still returns only the reason. So the one existing `files.info` call answers "may this requester see it", "what is it" and "how do we download it".

The function calls `files.info` first on every check. A session grant, checked afterwards, only skips the membership-evidence checks. The facts therefore come with every allowance, granted or not, and the call count is unchanged.

_Alternative:_ a separate persisted file-type cache. Rejected: every text ref needs a per-requester access check anyway, and that check already makes the call that returns the type. A persisted cache would save nothing and would be a second place where file metadata lives.

### D4. Access rules per source

| Source of the ref                                                                  | Access evidence                                                        | Registered as                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `files[]` of the trigger message or thread context                                 | the requester is in that conversation (today's rule)                   | full ref                                                                                            |
| `files[]` of a message fetched by `fetch_slack_message` / `fetch_channel_messages` | the fetch tool already passed `checkConversationAccess` (today's rule) | full ref                                                                                            |
| bare id or file URL in any text                                                    | `checkFileAccess`                                                      | full ref when allowed; `{ id, kind: "file", inaccessible: true }` when denied, with no name or type |
| message permalink                                                                  | none at resolve time; `fetch_slack_message` checks on read             | `message` ref                                                                                       |

An inaccessible ref is listed as "a Slack file you can't access" and is never readable. This keeps the current guarantee that nothing the requester can't see reaches Claude.

### D5. One registry: `availableRefs`

`QueryToolContext.availableRefs: Map<string, SlackRef>` replaces `availableImages` and `availableFiles`.

- **At the start of a run:** `processMessage` resolves three sources into it, replacing the merge loops in `core.ts:776-791`:
  - the **current message**: the event that started this run (`params.messageText` plus `params.files`). On a session's first run that's the trigger; on a later run, the follow-up reply.
  - the session's original trigger;
  - every thread-context message.

  Each `SlackRef` carries `fromCurrentMessage: boolean`.

  A `scheduled` trigger resolves its attachments but not its prompt text. A cron prompt is admin-authored instructions, not a user's message, and may hold example or template ids. Resolving them would cost a `files.info` call per id on every fire and could list items nobody asked about.

  Today the prompt renders a follow-up only as "ADDITIONAL INSTRUCTIONS FROM USER" (`promptBuilder.ts:672`), and nothing resolves its text. In production that let `F0BSE12AF7Z` in a follow-up go unregistered (DM D0EXAMPLE04, 2026-10-05).

- **Late-arriving attachments:** Slack can add a canvas or List link's `files[]` entry after the message event, when it unfurls the link. In that production thread the triggering event carried no files, yet `conversations.replies` returned them one turn later. Resolving the text ref through `files.info` makes the current message's refs independent of that timing.
- **Queued onto a live run:** a message sent while a run is answering is pushed into that run with `sendUpdate(text)`, and `processMessage` returns before building a context (`core.ts` ~669-707). That message's text refs and `files` are resolved too and added to the live run's registry as current-message refs, and the pushed text gains the same `[referenced: …]` tag the thread context uses. Without this, a file attached to a follow-up sent mid-answer never reaches Claude.
- **Mid-run:** `fetch_slack_message` and `fetch_channel_messages` resolve the messages they return into the same map. Their results keep a `files` array per message (each entry: `file_id`, `name`, `kind`, `reader`) and drop the separate `images` array.

### D6. Readers resolve their argument through the resolver

`view_slack_file`, `read_list`, `get_list_item`, `read_canvas`, `edit_canvas` and `fetch_slack_message` each turn their argument into a `SlackRef`:

1. **Lookup:** look it up in `availableRefs`. For `view_slack_file` and `fetch_slack_message`, a hit costs no call.
2. **Resolve:** otherwise, resolve it with the requester's access check, and register the result.
3. **Check the kind:** a ref of another kind gets the kind table's redirect: "`F…` is a Slack List: use read_list". An inaccessible ref returns the existing access-denied message.

This removes today's "Unknown file_id … Available: …" failure. A file id Claude finds in a search result or in memory just works when the requester can see it.

**List and canvas tools still check access on every call.** `read_list`, `get_list_item`, `read_canvas`, `edit_canvas` and the List write tools keep calling `checkFileAccess` before any content call, as the canvas and List specs require. A registry hit only supplies the kind, for the redirect. Two reasons:

- A file attached to a message is registered from its attached facts, without an access check.
- A registry entry carries no `botAccess`, which the write gates need.

The extra call is cheap: `read_list` needs `files.info` for the List schema anyway. The write-side checks (`openList`'s `botAccess` refusal and the edit gates) are unchanged.

### D7. `view_slack_file` absorbs `view_slack_image`

The image path (cached base64 → `image` content block, download on miss, the `too_large` notice) moves into `view_slack_file` as one more tier next to `pdf`, `text` and `unsupported`. The shared download helper moves into `viewSlackFile.ts`. `view_slack_image` is removed from the server, `toolNameValidator.ts` and `tool_mapping/clack.json`. This is the only Claude-facing tool removal. It removes the most common wrong choice, and the kind table already routes images to the one tool.

### D8. One prompt section, derived from the table

The ATTACHED FILES section becomes REFERENCED SLACK ITEMS. It has one line per registered ref, `- [<label>] <name> (id: <id>) → <reader>`, with the existing `too_large` and inaccessible variants.

- **Two groups.** Refs with `fromCurrentMessage` come first, under "named in this message"; the rest follow under "earlier in the conversation". In the production thread that motivated this, the prompt put a stale canvas from the first message ahead of the List the user had just asked about.
- **The open-before-answering rule** applies only to current-message refs of a `mustOpen` kind (images, documents). Earlier attachments, and Lists, canvases and messages anywhere, are read when the question needs them.
  - A 500-row List isn't forced into every run.
  - An old attachment can't take over a follow-up's answer. Today's "You MUST view each attachment listed below" (`promptBuilder.ts:623`) applies to every thread attachment, and that's what sent Claude to the stale canvas.
- Thread-context lines (`promptBuilder.ts:252-261`) replace the two tag kinds with one `[referenced: <label> <name> (id), …]` tag built from the same refs.

### D9. One attachment list on messages and sessions

`ThreadMessage`, the trigger params, and the session trigger carry one `files: SlackFileBase[]` of every kind. `extractAttachments` returns that single list, parsed with a zod schema (`slackFileZod`) instead of the hand-rolled guards. The 20 MB `too_large` marking is unchanged. The cap stays 10 per kind group: up to 10 images and 10 other files per message, as the two separate extraction passes allow, so a message with 10 images and 7 PDFs keeps all 17.

`SlackFileBase` carries no kind; kind exists only on a resolved `SlackRef`. Handlers that branch on "has images" test `files` with the kind table's `image` matcher (exported as `isImageFile`), which reads only the file's own facts and needs no config:

- `assistant`, `classicDm` and `mention` (the image-only message case);
- `autoRespond` (`buildImageOnlyPreAnalysisText`);
- `newQuery`.

Persisted sessions keep loading: the session reader merges a legacy `imageFiles` into `files`, permissively and without a migration. The merge sits in the existing legacy-normalization step (`sessions.ts` ~469-508), and the edit stays within the type fields and that merge. New writes carry only `files`. The pending `sessions-loader-onto-zod` change must model `files` plus the legacy `imageFiles` on `SessionTrigger` and `ThreadMessage`.

## Risks / Trade-offs

- **[The List `filetype` value comes from the slack-lists spike, not this one]** → The canvas values are pinned from a live `files.info` (`filetype` "quip", mimetype `application/vnd.slack-docs`). For Lists, `filetype === "list"` is what `lists.ts` already checks (`lists.ts:151`), and a live `files.info` on a real List confirmed it (task 1.1b).
- **[Removing `view_slack_image` breaks a stored tool label or an instruction file naming it]** → The tool_mapping entry is removed in the same change. A search of `data/default_configuration` shows no instruction text naming it. An operator override in `data/configuration` that names it would only mislabel a call, never break a run.
- **[More `files.info` calls on text-heavy threads]** → One call per distinct file ref in text, per run, capped at 10 per input and coalesced by id within a run. Message `files[]` cost nothing. `files.info` has a far higher rate limit than the `slackLists.*` methods.
- **[Large refactor surface: handlers, sessions, prompt, two fetch tools]** → The tasks split the change into slices that each keep the suite green: resolver, then registry swap, then readers, then the view-tool merge, then the attachment-list unification. The resolver and kind table are unit-tested exhaustively, independent of their callers.
- **[A future Slack type is misclassified by a too-broad `matches`]** → The table is checked in order with the catch-all last, and each entry's `matches` keys on exact `filetype` values or exact mimetype sets.

## Migration Plan

- **Data:** no migration. Old sessions are read through the merged `files` path (D9).
- **Deploy:** a normal image deploy. There are no config keys, no scopes and no manifest change.
- **Rollback:** redeploy the previous image. Sessions written by the new code carry `files` only, and the old code reads `files` (it ignores the missing `imageFiles`), so on those sessions an image attachment shows up under the old code as a file it can't open. Nothing fails, and new messages are unaffected.

## Open Questions

None. The live facts the kind table depends on are recorded in tasks 1.1, 1.1b and 1.2.

## Slack Lists close-out

This change also closes the in-flight `slack-lists` change. A live `files.info` and `slackLists.items.list` on a real List verified the shapes its task 1.1 left open. This change adds a real-shape fixture and tests for those shapes, updates the slack-lists "List reference parsing" requirement to the redirect behavior of D6, and archives slack-lists in the same commit.
