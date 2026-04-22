## 1. Scaffolding

- [x] 1.1 Create `src/plugins/gif/` with `index.ts` (plugin entry) and `types.ts` (result types)
- [x] 1.2 Register the plugin in `src/plugins/registry.ts` (`BUILTIN_PLUGINS.gif = gifPlugin`)
- [x] 1.3 Append `"gif"` to `data/config.json → plugins`

## 2. Tenor client

- [x] 2.1 Add `src/plugins/gif/tenor.ts` with a small `searchTenor({ query, limit, apiKey })` function using native `fetch`
- [x] 2.2 Hard-code `contentfilter=high`, `client_key=clack`, `random=true` in the request URL
- [x] 2.3 Parse the response into `{ url, previewUrl, title }[]` — prefer the `gif` or `mediumgif` variant for `url`, `tinygif` for `previewUrl`
- [x] 2.4 Handle Tenor error responses (non-200) by throwing a typed error with the status and body
- [x] 2.5 Unit test `tenor.ts` (mock `fetch`): successful parse, empty results, non-200, network error

## 3. find_gif tool

- [x] 3.1 Add `src/plugins/gif/findGif.ts` that exports `createFindGifTool()` returning an `SdkMcpToolDefinition`
- [x] 3.2 Zod schema: `{ query: z.string(), limit: z.number().min(1).max(10).optional() }` (default `limit` = 1 when unset)
- [x] 3.3 Read `process.env.GIF_TENOR_API_KEY` at invocation time; if missing return a text error pointing to `data/auth/.env`
- [x] 3.4 Call `searchTenor` and return a JSON-serialized array of `{ url, previewUrl, title }` as the tool's text content
- [x] 3.5 Unit test `findGif.ts`: missing key path, successful path, Tenor-error path, default-limit behavior

## 4. Instructions

- [x] 4.1 Add `src/plugins/gif/usageInstruction.ts` exporting the `GIF_USAGE_INSTRUCTION` string
- [x] 4.2 Instruction content MUST include: (a) call `find_gif` when a GIF would fit, (b) NEVER paste a URL not returned by `find_gif`, (c) one GIF max per message, (d) do NOT include a GIF in reaction-triggered (ephemeral) responses — only in DM and @mention modes, (e) append "via Tenor" attribution to any message containing a GIF
- [x] 4.3 In `index.ts`, call `sdk.addInstruction("user", "usage", GIF_USAGE_INSTRUCTION)` so it resolves to `user/gif__usage.md`

## 5. Plugin wiring

- [x] 5.1 In `src/plugins/gif/index.ts`, register the `find_gif` tool via `sdk.registerTool("member", createFindGifTool(), "Finding a GIF — {query}")`
- [x] 5.2 Verify the tool mapping string renders correctly in Slack task cards (query interpolated)
- [x] 5.3 Plugin-level smoke test: load the plugin through `createClackSdk`, harvest, confirm one instruction and one tool are registered

## 6. Config and secrets

- [x] 6.1 Document `GIF_TENOR_API_KEY` in the setup docs (README or `data/auth/.env.example`) with a link to Google Cloud Console and Tenor API enablement steps
- [x] 6.2 Confirm the key loader reads from `data/auth/.env` at startup (reuse existing mechanism, no new code)

## 7. Verification

- [x] 7.1 `npm run build` passes with strict TS
- [x] 7.2 `npm run test` passes (new unit tests included)
- [x] 7.3 Manual smoke: start the bot with a real key, send a DM like "celebrate this PR 🎉", confirm Claude calls `find_gif`, posts a URL, Slack unfurls it, and the body contains "via Tenor"
- [x] 7.4 Manual smoke: reaction-triggered (ephemeral) response → confirm no GIF is included
- [x] 7.5 Manual smoke: unset the key, confirm the tool returns a friendly error and the plugin still loads
- [x] 7.6 Run `openspec validate add-gif-plugin --strict`
