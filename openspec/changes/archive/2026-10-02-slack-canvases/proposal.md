## Why

People keep runbooks, specs and status pages in Slack canvases, and Clack cannot open them: a canvas link in a question is opaque to it. Clack also has no way to keep a long-lived document, such as a status page refreshed on a schedule, or to hand back an answer too long for a thread. Slack exposes canvases to apps through `canvases:read` / `canvases:write`, and the requester-access check (`src/slack/requesterAccess.ts`) now makes it safe to open files on someone's behalf.

## What Changes

- Add a top-level `canvases` config block: `{ mode: "off" | "read" | "write", writeRole?: UserRole }`, fail-fast zod, default `mode: "off"` (fully inert), `writeRole` default `"dev"`.
- The manifest follows the mode: `read` adds the `canvases:read` bot scope, `write` adds `canvases:read` and `canvases:write`. No bot events. Enabling, or moving from `read` to `write`, requires re-uploading the manifest AND reinstalling the app; the scope drift check reports a stale token.
- `read` mode registers `read_canvas` for every role: it takes a canvas id or URL, runs `checkFileAccess`, and returns the canvas as markdown.
- `write` mode also registers, for roles at or above `writeRole`:
  - `create_canvas` — creates a standalone canvas from a title and markdown. Outside a DM it shares the canvas with the session's channel (read); it records a session grant and returns the canvas id and permalink.
  - `edit_canvas` — one operation per call (`insert_after`, `insert_before`, `replace`, `delete` on a section found by its text; `insert_at_start`, `insert_at_end`; `rename`). Sections are found by text through `canvases.sections.lookup`; zero or several matches are refused. Replacing the whole document is allowed only on canvases Clack created.
- `read` mode never registers a write tool, so Clack cannot write any canvas.
- No tool deletes a canvas or changes canvas access, other than the read share `create_canvas` performs on its own channel.
- `checkFileAccess`'s allowed verdict also reports the file's creator, so `edit_canvas` can tell canvases Clack created.

## Capabilities

### New Capabilities

- `slack-canvases`: the `canvases` config gate and the `read_canvas`, `create_canvas` and `edit_canvas` tools.

### Modified Capabilities

- `manifest-generation`: the `canvases` mode adds the canvas scopes.
- `slack-requester-access`: the allowed file verdict carries the file's creator.

## Impact

- New: `src/slack/canvases.ts` (Slack calls and error mapping), `src/tools/query/readCanvas.ts`, `src/tools/actions/createCanvas.ts`, `src/tools/actions/editCanvas.ts`, each with tests.
- Changed: `src/configSchemas.ts` (`canvasesZod`, `manifestConfigZod`), `src/configZod.ts`, `src/config.ts`, `src/tools/admin/configSchema.ts`, `src/slack/requiredScopes.ts`, `src/slack/requesterAccess.ts`, `src/tools/server.ts`, `src/tools/servedToolSchemas.integration.test.ts` (gate opened), `CLAUDE.md`.
- Slack API: `canvases.getContent`, `canvases.create`, `canvases.edit`, `canvases.sections.lookup`, `canvases.access.set`, `files.info`, `conversations.info`. `getContent` and the `rename` operation are not typed by `@slack/web-api` 8.1.1 and go through `client.apiCall`.
- Plans: canvases need a paid Slack plan; on a free plan the write tools report Slack's plan error.
