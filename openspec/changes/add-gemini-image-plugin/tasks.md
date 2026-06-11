## 1. Dependency & scaffolding

- [x] 1.1 Add `@google/genai` to `package.json` and install; confirm it type-checks under NodeNext ESM.
- [x] 1.2 Create `src/plugins/gemini-image/` and register the plugin with one line wherever the other plugins are registered (sibling of `giphy`).
- [x] 1.3 Document `GEMINI_API_KEY` in the README and add it to the `data/auth/.env` example/setup notes.

## 2. Gemini API boundary (`gemini.ts`)

- [x] 2.1 Implement `loadGeminiApiKey()` reading `process.env.GEMINI_API_KEY` (mirror giphy's `getApiKey`).
- [x] 2.2 Implement `generateImage({ prompt, model })` → `{ data: base64, mimeType }` against `@google/genai`; confirm exact model IDs and response shape against live Gemini docs.
- [x] 2.3 Edit path is folded into `generateImage({ ..., input })`: when `input` is set, contents become `[{ inlineData }, { text: prompt }]` (image-to-image) on the edit-capable model. (No separate `editImage` — one code path.)
- [x] 2.4 Define a `GeminiError`/`SourceError`-style structured error type so the tool can return clean envelopes; no throws across the boundary.

## 3. Tier→model config (`models.ts`)

- [x] 3.1 Define built-in tier map (real current IDs, confirmed via docs): `fast → gemini-2.5-flash-image`, `best → gemini-3-pro-image-preview`, `edit → gemini-2.5-flash-image`.
- [x] 3.2 Implement an in-memory cache overridable by `data/plugins/gemini-image/models.json`, loaded via `sdk.readFile` and hot-reloaded via `sdk.watchFile` (runtime-only value → no restart).
- [x] 3.3 Expose `resolveModel(quality, { edit })` used by the tool; never surface raw IDs in the tool schema.

## 4. The `generate_image` tool (`generateImage.ts`)

- [x] 4.1 Define the arg schema: `prompt` (required, non-empty, max length), optional `input_image` (Slack file reference), `quality: "fast" | "best"` (default `fast`), `deliver: "upload" | "data" | "both"` (default `upload`), optional `channel` + `thread_ts` (used only by `upload`/`both`; Claude fills `channel` from the prompt's "Channel ID").
- [x] 4.2 Write the tool description so it unambiguously states the image is AI-GENERATED and not a real-subject photo (anti-trivia, English / via-Claude path).
- [x] 4.3 Validate input; on empty prompt or unresolvable `input_image`, return a structured error without calling Gemini.
- [x] 4.4 Edit branch: fetch the Slack source image bytes using the bot token (via the Slack client), pass to `editImage`.
- [x] 4.5 Generate branch: call `generateImage` with the resolved model.
- [x] 4.6 Implement `deliver`: `upload` → `filesUploadV2` to `channel` (threaded under `thread_ts` when given) with a neutral filename, return `{ fileId, permalink }` text; `data` → multimodal `{ type:"image", data, mimeType }`; `both` → both. Include a `provenance: "ai-generated"` / `generated: true` marker and OMIT any `license`/`attribution`/`subjectId`.
- [x] 4.7 For `upload`/`both`, require the `channel` arg; if absent, return a structured error directing the caller to supply a `channel` or use `deliver: "data"` (covers DMs/channelless where no channel ID is surfaced).
- [x] 4.8 Missing-key path returns the clear "set GEMINI_API_KEY in data/auth/.env" error envelope.

## 5. Plugin wiring (`index.ts`, `usageInstruction.ts`)

- [x] 5.1 `registerDictionary({ en, fr })` for any direct-to-Slack strings (e.g. the tool label, upload notice) via `sdk.t()`.
- [x] 5.2 `registerTool("member", createGenerateImageTool(), sdk.t("label.generate_image"))`.
- [x] 5.3 Write `usageInstruction.ts` (English) and `sdk.addInstruction("user", "usage", ...)`: when to use, the `deliver` modes, the slack_file-not-image_url note, and that output is always AI-generated.

## 6. Tests

- [x] 6.1 `gemini.test.ts` — mock `@google/genai`; assert generate/edit map prompt+model→bytes and error mapping.
- [x] 6.2 `models.test.ts` — tier resolution, default `fast`, override-file hot reload, edit-model selection.
- [x] 6.3 `generateImage.test.ts` — deps-injected; cover each `deliver` mode, generate vs edit branch, empty-prompt rejection, unresolvable input image, missing-key path, and that the envelope marks provenance and omits license/attribution/subjectId.
- [x] 6.4 `plugin.test.ts` — registration: tool name `mcp__gemini-image__generate_image`, member gating, dictionary + usage instruction installed.
- [ ] 6.5 (Optional) `gemini.integration.test.ts` behind the `*.integration.test.ts` suffix for a real keyed smoke test.

## 7. Verify

- [x] 7.1 `npx tsc` clean; `npx oxlint src/plugins/gemini-image` and `npx oxfmt src/plugins/gemini-image` clean.
- [x] 7.2 `npm test` green.
- [x] 7.3 Confirm trivia's visual flow does not match the tool (description-based discovery) — sanity check against `docs/image-search-contract.md`.
- [x] 7.4 `openspec validate add-gemini-image-plugin --strict` passes.
