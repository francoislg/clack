## Context

Clack has three image plugins (`giphy`, `commons-image-search`, `brave-image-search`) — all **find and re-host** existing images. None can **create** one. This change adds a generator backed by the Google Gemini image API. The `betaflag/imagine` CLI inspired the idea but is a Go binary with no MCP surface and no editing, so it is reference-only; we call the Gemini API directly.

Constraints that shape the design:

- **Plugin hard rules** (`src/plugins/CLAUDE.md`): no imports outside the plugin folder except the SDK and third-party packages; all Slack/file/log access through the SDK.
- **i18n rules** (`CLAUDE.md`): direct-to-Slack strings go through `sdk.t()`; tool descriptions and result envelopes consumed by Claude stay English.
- **Test rules**: vitest; mock the Gemini and Slack boundaries; no real network in unit tests; integration tests use the `*.integration.test.ts` suffix.
- **Anti-trivia requirement**: trivia discovers image sources by tool *description* (`docs/image-search-contract.md`), so provenance wording is load-bearing, not cosmetic.

Reference patterns: `giphy` (single member-gated tool, `process.env` key, usage instruction) and `brave-image-search/findImage.ts` (multimodal `{ type:"image", data, mimeType }` + text result via the raw MCP content shape).

## Goals / Non-Goals

**Goals:**

- One member-gated tool that both generates (text→image) and edits (image+text→image).
- Model choice exposed as a high-level `quality` tier; raw model IDs never reach Claude; tier→model map is admin-editable config (hot-reloaded).
- Flexible delivery: Slack upload, inline bytes to Claude, or both.
- Provenance is structurally unmistakable so trivia never treats it as a real-subject source.
- Graceful no-key degradation; zero impact on other plugins or startup.

**Non-Goals:**

- Hosting images on a public CDN / minting public shareable URLs (Gemini returns bytes; the only "URL" is the auth-gated Slack permalink).
- Image search / real-subject sourcing (that's the existing image-search plugins).
- Video, audio, or multi-image batch generation.
- Per-user quota/cost controls beyond what the API key enforces (possible fast-follow).

## Decisions

### Decision 1: Direct Gemini API (`@google/genai`), not the imagine binary

Shelling out to the Go binary would require shipping it in `node:22-alpine`, parsing stdout, re-reading files from disk, and — critically — would never support editing. Direct API is pure TS, one dependency, and unlocks image-to-image. **Alternative considered:** wrap the binary. Rejected: build friction + no editing, which is half the feature.

### Decision 2: Single tool `generate_image` with an optional `input_image`

Generation and editing share a prompt, a quality tier, and a delivery mode; the only difference is the presence of an input image. One tool with an optional `input_image` keeps the surface small and lets Claude flow "generate → then edit the result" naturally. **Alternative:** two tools (`generate_image` / `edit_image`). Rejected: duplicated schema and delivery logic for a one-field difference.

### Decision 3: `quality` tier enum, mapping in hot-reloaded config

Argument schema exposes `quality: "fast" | "best"` only. Built-in defaults: `fast → gemini-3.1-flash-image`, `best → gemini-3-pro-image`; the edit path resolves to an edit-capable model (`gemini-2.5-flash-image`, "nano-banana"). An optional `data/plugins/gemini-image/models.json` overrides the map and is read live by the tool handler, so per the plugin reload rules this is a **runtime-only value → pure hot-reload** via `sdk.watchFile` updating an in-memory cache — no restart. **Alternative:** expose raw model IDs. Rejected: leaks vendor detail, ages badly, and the user explicitly wanted high-level entities.

### Decision 4: `deliver` enum (`upload` | `data` | `both`), default `upload`, with an explicit `channel` arg

Gemini returns raw bytes. The three modes map to three real consumption shapes: post-to-thread (the common case), inline-to-Claude (inspect / chain into an edit), or both. `upload`/`both` use `sdk.getSlackClient().filesUploadV2(...)` with a **neutral filename** (no prompt leak) and return `{ fileId, permalink }` as text; `data`/`both` return the bytes as a multimodal image block exactly like `brave-image-search`. The Slack permalink is auth-gated and is referenced elsewhere via `slack_file: { id }`, not `image_url` — documented in the usage instruction so Claude doesn't try to embed a private URL.

**Channel sourcing — the constraint that shaped this:** plugin tools registered via `sdk.registerTool` are **global**, not rebuilt per session, so unlike core's `upload_file` they have **no `ctx.session.channelId`**. The tool therefore takes an explicit `channel` (+ optional `thread_ts`) argument that Claude fills from the prompt's "Channel ID" line. This works in channel/@mention contexts (where the prompt surfaces the channel ID). In **DMs and channelless cron** the prompt does not surface a channel ID, so `upload`/`both` cannot resolve a destination — the tool returns a structured error telling Claude to use `deliver: "data"` there. **Alternatives considered:** (B) expand the SDK with an AsyncLocalStorage-backed `getCurrentSlackContext()` so upload works everywhere with no arg — deferred as a larger core change; (C) data-only — rejected because Gemini has no upstream URL and Block Kit can't embed raw bytes, so the image would never reach the user. The explicit-arg approach is near-zero core impact and actually delivers the image; the SDK-ambient-context upgrade remains a clean future follow-up that would let `channel` become optional.

### Decision 5: Provenance via description + envelope, and the absence of a `media` block

Two structural guarantees keep this out of trivia: (1) the tool description states it generates AI images, not real-subject photos — so trivia's by-description scan never matches it; (2) the result envelope carries a `generated: true` / `provenance: "ai-generated"` marker and deliberately omits `license`/`attribution`/`subjectId`, so even if matched it can't satisfy trivia's `save_question` media gate. Belt and suspenders.

### Decision 6: Module layout mirrors `giphy` / `brave-image-search`

```
src/plugins/gemini-image/
  index.ts            # ClackPlugin: registerDictionary, addInstruction, registerTool
  generateImage.ts    # tool def + arg schema + deliver/provenance logic (deps-injected)
  gemini.ts           # Gemini API boundary (generateImage/editImage, key load) — the mock seam
  models.ts           # tier→model defaults + hot-reloaded override cache
  usageInstruction.ts # member usage instruction (English; via-Claude path)
  *.test.ts           # unit tests mocking gemini.ts + the Slack client
```

The Gemini call and the Slack client are the two injected boundaries, so unit tests never touch the network. Plugin registered with one line wherever the others are.

## Risks / Trade-offs

- **Model IDs (`gemini-3.1-flash-image`, etc.) may not match the live Gemini catalog at build time** → the tier→model map is config with sane defaults; verify exact IDs against the Gemini API docs during implementation and make them overridable so a rename is a config edit, not a redeploy.
- **`@google/genai` SDK shape (response → bytes/base64, mimeType) is assumed** → isolate all SDK usage in `gemini.ts`; the rest of the plugin depends only on a `{ data, mimeType }` result, so an SDK surprise is contained to one file.
- **Generated images could be misused as "real" content (e.g. fake screenshots, a real person's likeness)** → provenance marker + description; the upload caption/usage instruction reminds Claude to label generated images. Out of scope: content moderation beyond Gemini's own safety filters.
- **`files.uploadV2` needs a channel/thread context, but plugin tools are global (no session context)** → the tool takes an explicit `channel`/`thread_ts` arg Claude fills from the prompt's "Channel ID"; in DMs/channelless (no channel ID surfaced) `upload`/`both` return a structured error directing `deliver: "data"`. A future SDK ambient-context method (Decision 4, alt B) would make `channel` optional.
- **Cost** → no per-user metering in v1; relies on the single shared API key. Note as a fast-follow if usage grows.

## Migration Plan

Additive and self-contained. Deploy: add `@google/genai`, register the plugin, set `GEMINI_API_KEY` in `data/auth/.env`, document in README. No data migration. Rollback: delete `src/plugins/gemini-image/` and its registration line; remove the dependency. No other code references the plugin.

## Open Questions

- Exact current Gemini image model IDs and the `@google/genai` call/response shape — confirm against live docs at implementation time (Decision 3/Risk 1).
- Should `quality` gain a third explicit tier for editing (e.g. `edit`), or is the edit model purely internal to the edit path? Current plan: internal — `quality` stays generation-only and editing auto-selects the edit-capable model.
- Default image size/aspect — expose as args now or defer? Leaning defer (sane default), add later if requested.
