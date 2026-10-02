## Context

Slack canvases are files (`F…` ids, `filetype: "quip"`). The bot token sees a canvas it created, one shared with it, or one shared to a channel it is in. `checkFileAccess(req, fileId)` (`src/slack/requesterAccess.ts`) already answers "can the requester see this file?" from `files.info` and reports the bot's own `access` (`read` / `write`; a canvas the bot owns reports neither). A run with no requester (plugin cron) is allowed only on files shared to a channel the bot may read for it.

Slack API facts the design rests on:

- `canvases.getContent {canvas_id, content_type: "markdown"}` returns the whole canvas as one markdown string, in the same dialect `create` and `edit` accept (h1–h3, lists, checklists, tables, callouts, mentions, unfurls; no Block Kit). Max 1 MiB.
- `canvases.edit` accepts exactly one change per call. Operations: `insert_after`, `insert_before`, `insert_at_start`, `insert_at_end`, `replace`, `delete`, `rename` (with `title_content`).
- `canvases.sections.lookup {criteria: {contains_text?, section_types?}}` returns section ids only, no text.
- `canvases.create` returns only `canvas_id`; the creating token owns the canvas. `canvases.access.set` with `channel_ids` shares to channels (not DMs or group DMs); with `user_ids` it requires the user to have been sent the canvas directly first.
- No canvas change events exist.
- Canvases need a paid plan (`free_teams_cannot_create_standalone_canvases`, `free_teams_cannot_edit_standalone_canvases`).

## Goals / Non-Goals

**Goals:** read a canvas someone links; create a canvas for a long answer or a living document; edit a canvas section by section; a `read` mode that cannot write.

**Non-Goals:** deleting canvases; managing canvas access beyond the share at creation; channel-tab canvases (`conversations.canvases.create`); reacting to canvas changes; canvases on free plans.

## Decisions

### D1. One config block with a three-state mode

`canvases: { mode: "off" | "read" | "write", writeRole?: "member" | "dev" | "admin" | "owner" }`, fail-fast zod (unknown keys rejected, like `investigations`), parsed in `configZod.ts`, added to `manifestConfigZod`. Absent block ≡ `mode: "off"`. A mode, not two booleans, so "write without read" cannot be expressed. `writeRole` defaults to `"dev"` (same tier as `propose_change`); the `system` role of cron runs passes any threshold through `meetsMinimumRole`, as for other tools.

### D2. Scopes in `requiredScopes.ts`

`ManifestFeatures` gains `canvases: "off" | "read" | "write"`; `requiredBotScopes` adds `canvases:read` for `read` and `canvases:read` + `canvases:write` for `write`. Both scopes join `UntypedBotScope` (the manifest type in `@slack/web-api` 8.1.1 does not list them). The scope drift check picks them up with no change of its own.

### D3. Access check before every call

Each tool resolves the canvas id, then calls `checkFileAccess({ client, userId, role, session }, canvasId)` and refuses with `FILE_ACCESS_DENIED_MESSAGE` on a denial. `edit_canvas` additionally refuses up front when `botAccess === "read"`. An unknown `botAccess` (Clack owns the canvas, or Slack did not say) proceeds and lets Slack decide.

### D4. Anchor by text, never by section id

Section ids are opaque to Claude (lookup returns no text), so `edit_canvas` takes `anchor_text` and resolves it with `sections.lookup {criteria: {contains_text}}`. Zero matches → error telling Claude to read the canvas and pick text from it. Several → error asking for more specific text. One → the edit. Claude is told to `read_canvas` before editing.

### D5. Whole-document replace only on canvases Clack created

`replace` without `anchor_text` rewrites the whole canvas. It is allowed only when the file's creator is Clack's bot user (`getBotUserId`). To know the creator without a second `files.info`, `checkFileAccess`'s allowed verdict gains `creator: string | undefined` (the `user` field it already parses). Living documents Clack maintains are the case this serves; a human's canvas is edited section by section.

### D6. Sharing what Clack creates

`create_canvas` creates a standalone canvas, then, when the session channel is not a DM or group DM, calls `canvases.access.set {access_level: "read", channel_ids: [session.channelId]}` so the people in the conversation can open it. It records a session grant (`addAccessGrant`) so later turns pass the access check even in a DM. It does not try `user_ids` grants (they fail unless the canvas was sent directly first). A failed channel share does not fail the tool: the canvas exists, so the result carries the id, the permalink and a warning. The permalink comes from `files.info`.

People edit a Clack canvas through Clack; there is no owner transfer.

### D7. Slack layer in one module

`src/slack/canvases.ts` holds the Slack calls (`getCanvasMarkdown`, `createCanvas`, `shareCanvasWithChannel`, `findSections`, `editCanvas`, `canvasPermalink`) and `canvasErrorMessage(error)`, which reads the code with the existing `slackErrorCode` (`src/slackErrors.ts`) and maps Slack error codes to Claude-facing English: `missing_scope` (manifest re-upload + reinstall), `free_teams_cannot_*` (paid plan), `canvas_not_found` / `canvas_deleted`, `access_denied` / `no_permission`, `canvas_editing_locked`, `canvas_too_large`, `ratelimited`. Tools take the module through an injected deps object (the `searchMessages` pattern) so unit tests mock the boundary.

### D8. Canvas references

`read_canvas` and `edit_canvas` accept a canvas id (`F` + alphanumerics) or a Slack canvas URL (`https://<ws>.slack.com/docs/<team>/<file>`, also `/canvas/<file>` forms); the parser extracts the `F…` id and rejects anything else.

### D9. Content size

`read_canvas` returns the markdown up to 100,000 characters; beyond that it truncates and says so, so a 1 MiB canvas does not flood the context.

## Risks / Trade-offs

- **Non-atomic multi-step edits** → each call is one Slack operation; a failure mid-sequence leaves earlier steps applied. Tool descriptions say so, and the error names which step failed.
- **Directly shared canvases** → a canvas shared with a person but not a channel may be denied to them by the access check (no Slack API reads a per-user access list). Accepted: the check denies on missing evidence by design.
- **A viewer can edit through Clack** → Slack exposes no per-user access level, so a requester who can only view a canvas can still have Clack edit it when the bot has write access. The gate is `writeRole` + requester-can-see + bot-can-write. Accepted; operators who need tighter control raise `writeRole` or stay in `read` mode.
- **Text anchors drift** → if a heading changes between `read_canvas` and `edit_canvas`, the lookup fails cleanly rather than editing the wrong section.
- **Untyped methods** → `getContent` and `rename` go through `client.apiCall`, so their responses are parsed with zod.

## Migration Plan

No data migration. Operators set `canvases.mode`, regenerate and re-upload the manifest, and reinstall the app. Setting `mode: "off"` (or removing the block) unregisters the tools; the scopes stay on the token until the next manifest upload.
