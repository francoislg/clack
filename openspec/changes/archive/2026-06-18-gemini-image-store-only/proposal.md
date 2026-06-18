## Why

The `add-gemini-image-plugin` capability shipped `generate_image` with a `deliver` arg (`upload` | `data` | `both`) that **posts** the result to a Slack `channel`. Two problems surfaced in use:

- **The channel-posting path is unreliable and inflexible.** `upload`/`both` require an explicit `channel`, which is unavailable in DMs and channelless runs; and posting at generation time forecloses Claude composing the image into a richer `submit_response` (it lands as a bare file in the channel). The companion `delivery-context` requirement that surfaced `thread_ts` exists *only* to steer that direct upload — extra prompt surface for a fragile path.
- **There was no way to reference a generated image later.** Once posted, the file's `permalink` is auth-gated and does **not** render in a Block Kit `image` block's `image_url` (Slack's image proxy fetches `image_url` anonymously and gets a 403). So Claude could not embed the image in its own message.

Slack's Block Kit `image` block has a second source field, `slack_file: { id } | { url }`, that renders a Slack-owned (private, unshared) file inline **without** a public URL — checked by file access, not proxied. Combining the two: store the generated image unshared, hand Claude `{ fileId, permalink }`, and let Claude render it via `slack_file` wherever it wants.

## What Changes

- **`generate_image` becomes store-only.** It no longer posts to a channel. It uploads the result to Slack **unshared** (`files.uploadV2` with no `channel_id`, owned by the bot) and returns a text envelope `{ fileId, permalink }`. The `deliver`, `channel`, and `thread_ts` args are removed. No inline image bytes are returned (handle-only). Works identically in DMs, channels, and channelless runs.
- **Clack's curated `image` block accepts `slack_file`.** The block validator now accepts `alt_text` plus **exactly one** of `image_url` (a public URL) or `slack_file` (`{ id }` or `{ url }`, never both) — letting Claude render a stored/private Slack file inline via `submit_response`/`post_to`/`deliver_to`.
- **The direct-post thread hint is removed.** With nothing posting directly to Slack, the `delivery-context` requirement that surfaced `thread_ts` for direct-posting tools is dead and is removed.
- **Editing still works by reference.** `input_image_url` accepts the stored file's `permalink` (the tool fetches it with the bot token), so generate → refine → render is a pure-store loop with no intermediate posts.

## Capabilities

### Modified Capabilities
- `gemini-image-generation`: delivery becomes store-only (unshared upload returning `{ fileId, permalink }`, no inline bytes); the `Configurable delivery` requirement is removed in favor of a `Stored unshared delivery` requirement; the generate/edit requirements drop the "configured deliver channel" wording.
- `clack-tool-response`: the curated `image` block accepts `slack_file` (`{ id } | { url }`) as an alternative to `image_url`, with exactly-one-of validation.
- `delivery-context`: the `Thread Timestamp Surfaced for Direct-Posting Tools` requirement is removed (no tool posts directly anymore).

## Impact

- **Code (already implemented in the working tree):**
  - `src/plugins/gemini-image/generateImage.ts` — store-only handler, `store()` Slack dep (no `channel_id`), handle-only return.
  - `src/plugins/gemini-image/usageInstruction.ts` — rewritten delivery guidance (store → `slack_file: { id }`).
  - `src/slack/blockSchema.ts` — `AuthoredImageBlock` type + `slack_file` on the image schema.
  - `src/slack/blockValidate.ts` — image-source XOR validation (`image_url` vs `slack_file`).
  - `src/claude/promptBuilder.ts` — removed `directPostThreadHint` and its two call sites.
  - Docs: `docs/gemini-image-plugin.md`, `data/default_configuration/user/block-kit-formatting.md`.
- **Behavioral break:** any caller relying on `deliver: "upload"`/`"both"`/`"data"` must switch to store-then-render. The plugin shipped recently and the only consumer is Claude itself (steered by the usage instruction), so no migration of persisted data is required.
- **No impact** on incoming-image handling (`slack-image-support`), the core `upload_file` tool, trivia, or the Changes Workflow.
- **Note:** Slack's `slack_file` renders only `png`/`jpg`/`jpeg`/`gif` (not `webp`); Gemini emits `png`, so the generated path is unaffected.
