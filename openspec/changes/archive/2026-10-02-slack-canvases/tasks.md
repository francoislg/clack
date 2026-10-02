## 1. Config gate

- [x] 1.1 Add `canvasesZod` to `src/configSchemas.ts` (fail-fast: `mode` enum `off|read|write`, optional `writeRole` enum `member|dev|admin|owner`, unknown keys rejected, errors name the key) and add `canvases` to `manifestConfigZod`
- [x] 1.2 Wire `canvases` into `Config` (`src/config.ts`) and `src/configZod.ts` via `parseOrThrow`
- [x] 1.3 Add the `canvases` entry to `src/tools/admin/configSchema.ts` (description says enabling needs manifest re-upload + reinstall)
- [x] 1.4 Unit tests for `canvasesZod`: absent, each mode, default `writeRole`, invalid mode, invalid role, unknown key

## 2. Scopes

- [x] 2.1 `src/slack/requiredScopes.ts`: add `canvases:read` / `canvases:write` to `UntypedBotScope`, `canvases` to `ManifestFeatures` / `ManifestFeatureSource` / `manifestFeatures`, and the mode-driven scopes in `requiredBotScopes` (a separate hunk from other projects' edits)
- [x] 2.2 Tests: read adds only `canvases:read`; write adds both; off/absent adds none; events unchanged
- [x] 2.3 Manifest generator test: invalid `canvases.mode` fails naming the key

## 3. Requester access: creator on the verdict

- [x] 3.1 `src/slack/requesterAccess.ts`: allowed `FileAccess` gains `creator: string | undefined` from the parsed `files.info` `user`
- [x] 3.2 Tests: creator reported; creator absent; existing callers unaffected

## 4. Slack canvas layer

- [x] 4.1 Create `src/slack/canvases.ts`: `parseCanvasRef`, `getCanvasMarkdown` (`apiCall("canvases.getContent")`, zod-parsed), `createCanvas`, `shareCanvasWithChannel`, `findSections` (`canvases.sections.lookup` by `contains_text`), `editCanvas` (one change; `rename` via `apiCall`), `canvasPermalink` (`files.info`), `canvasErrorMessage` (code read with `slackErrorCode` from `src/slackErrors.ts`; unmapped codes reported verbatim)
- [x] 4.2 Unit tests with `createSlackClientMock()`: each call's arguments, zod rejection of malformed responses, ref parsing (id, `/docs/` URL, `/canvas/` URL, rejects message permalink), every mapped error code

## 5. Tools

- [x] 5.1 `src/tools/query/readCanvas.ts`: parse ref → `checkFileAccess` → markdown, truncated at 100,000 chars with a note
- [x] 5.2 `src/tools/actions/createCanvas.ts`: create → share to session channel unless DM/group DM (warning on failure) → `addAccessGrant` → id + permalink
- [x] 5.3 `src/tools/actions/editCanvas.ts`: parse ref → `checkFileAccess` → refuse on `botAccess: "read"` → resolve `anchor_text` (0 / >1 refused) → whole-replace only when `creator` is the bot user → one `editCanvas` call
- [x] 5.4 Unit tests for each tool, mocking `src/slack/canvases.ts` and `requesterAccess` at the boundary: denial path makes no canvas call, every scenario in `specs/slack-canvases/spec.md`
- [x] 5.5 Register in `src/tools/server.ts`: `read_canvas` when mode ≠ off and a Slack client exists; write tools when mode is write and `meetsMinimumRole(role, writeRole ?? "dev")`; registration tests per mode/role
- [x] 5.7 Add the three tool names to `CLACK_CORE_TOOL_NAMES` (`src/tools/toolNameValidator.ts`) and their task-card labels + a `canvases` group to `data/default_configuration/tool_mapping/clack.json`
- [x] 5.6 Open the `canvases: { mode: "write" }` gate in `src/tools/servedToolSchemas.integration.test.ts` , add `clack/edit_canvas` to `GATED_SENTINELS`, and confirm the three tools list and validate

## 6. Docs and verification

- [x] 6.1 `CLAUDE.md`: a "Slack canvases" section (config, modes, tools, access check, manifest re-upload + reinstall, paid plan)
- [x] 6.2 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on changed files, `npm test`
- [x] 6.3 `openspec validate slack-canvases --strict`
