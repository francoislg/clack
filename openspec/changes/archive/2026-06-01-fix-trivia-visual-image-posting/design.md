## Context

`add-trivia-visual-questions` shipped image-medium trivia with a mandatory Slack re-hosting hop in `post_questions`: download `media.url` → `files.uploadV2` → reference the uploaded file in the card's `hero_image`. The first live run failed completely (see the debug session for `C0A82GNR25V`): all image questions errored with `files.uploadV2 returned no file id` and each failed attempt leaked a card-less image into the channel.

The re-host was added to prevent the upstream filename (e.g. `Flag_of_Ecuador…png`) from leaking the answer via Slack's URL hover/unfurl. But it is the wrong tool for the job and is what broke the feature. The simpler design the user originally intended — render the image by URL — works: the image-search plugin's metadata block already returns a public `imageUrl` (Wikipedia/Commons thumbnails are public HTTPS), and Block Kit `image` blocks render public `image_url`s directly.

Stakeholders: admins running visual trivia (it must actually post), players (one clean image per question, no duplicate flood).

## Goals / Non-Goals

**Goals:**

- Image-medium questions post reliably: one card with its image rendered below it.
- Eliminate the stray-duplicate-image side effect entirely.
- Keep `post_questions` simple and medium-agnostic — no byte download, no `files.uploadV2`, no upload deps, no image-specific branch.
- Keep image layout (placement, adjacent context) under prompt control by having Claude build the block.
- Make the image block work in BOTH the inline and prep→post split flows by surfacing `promptMedium` + `media` to the record-reading tools.

**Non-Goals:**

- A post-time safety net. `post_questions` does not compensate for a missing image block; the prompt + surfaced fields are the contract.
- Leak-proofing the image URL. Re-introducing anti-leak re-hosting (done correctly) is a deliberate future change, not this one.
- Changing image generation, the visual research subflow, `find_previous_subjects`, or the `media` contract beyond removing the two upload-only fields.
- Changing how the image-search MCP tools work (they already return a public `imageUrl` in their metadata block).

## Decisions

### Decision 1: Render the public `media.url` directly; remove the Slack re-host

No byte download or upload for image-medium questions. The image is a Block Kit `image` block — `{ type: "image", image_url: media.url, alt_text: media.altText }` — rendering the upstream public URL directly. The `fetchImage` and `uploadImage` methods are removed from `PostQuestionsSlackDeps` and its default implementation; the per-item upload hop and the `hero_image` injection are deleted.

**Why URL, not re-host?** Three independent reasons, all confirmed by the debug session:

1. It works. Public Commons/Wikipedia thumbnail URLs render in Block Kit `image` blocks today. The re-host path failed on a response-shape bug (`result.files[0].files[0].id`, not `result.files[0].id`), a `channel_id` side-effect (uploads post to the channel as their own message), and the fact that a Slack `url_private` can't be used as `image_url` anyway.
2. It's simpler — no byte download through the bot, no MIME/format gate, no idempotency state (`slackFileId`).
3. The MCP "no URL mode" limitation that forced data-mode applies ONLY to the image-search tool *result* (Claude's inline inspection), never to Slack rendering. The metadata's `imageUrl` was always the post-time source of truth.

### Decision 2: Claude builds the image block; `post_questions` is medium-agnostic

The image block is built by the question-generation prompt and handed to `post_questions` inside the `blocks` array, exactly like the card/header/closer — `post_questions` does NOT inject, move, or special-case it. This makes the image "like every other block": built by the prompt, validated by `validateBlocks`, posted as-is. It also keeps placement and surrounding context under prompt control (the user's flexibility requirement), and keeps the medium-specific logic out of the tool.

Default placement is directly after the `card` block (`header` → `section` → `card` → **`image`** → … → appended `actions`), matching "an image component below the card." The prompt can deviate when a layout calls for it.

The earlier draft of this change injected the block in `post_questions` from the saved record. That was rejected: it hard-coded placement, prevented adjacent context, and was a vestige of the re-host era (when the URL only existed post-upload, so Claude couldn't build the block). With direct URLs, Claude already holds `media.url` — the same value it saved — so it can build the block itself.

### Decision 3: Surface `promptMedium` + `media` to the record-reading tools

For Claude to build the image block in the **prep→post split** flow, the posting run must see that a staged question is image-medium and have its `media.url`. The post run reads the staged pool via `find_previous_questions`, whose projection previously stripped both fields. So `find_previous_questions` (and `get_question_history`, for consistency) now include `promptMedium` + `media`. A small `mediaToJson` helper projects the closed `QuestionMedia` interface into a `JsonValue` for the tool result.

This replaces the rejected "safety-net injection": rather than have `post_questions` compensate for data Claude couldn't see, give Claude the data. There is no post-time fallback — if a run fails to include the image block, the question posts without one (text card still stands).

### Decision 4: Drop `slackFileId` / `slackFileUrl` from `QuestionMedia`

With no upload, these two fields have no writer and no reader. Remove them from the `QuestionMedia` interface. Legacy records that still carry them deserialize fine (extra JSON keys are ignored). No migration.

## Risks / Trade-offs

- **[Trade-off] URL/filename leak on hover/unfurl.** A Commons thumbnail URL contains the subject filename, which can hint the answer to a player who inspects the link. → **Accepted** for now (the feature working at all is the priority). Mitigations for later: suppress unfurls on image-question messages, or reinstate re-hosting via `files.uploadV2` WITHOUT `channel_id` + a `slack_file: { id }` block reference. Reverses `add-trivia-visual-questions` Decision 4 (mandatory re-hosting).
- **[Risk] Upstream image 404 / hotlink block at render time.** Slack fetches the `image_url` when rendering; if the upstream is gone or blocks hotlinking, the image shows broken. → Low for Wikimedia (stable, hotlink-friendly CDN). Per-plugin reliability is each image-search plugin's concern; the card text still stands on its own as a fallback.
- **[Trade-off] No leak gate / format gate at post time anymore.** SVG/oversized handling moves entirely to the image-search plugin + Slack's own renderer. → Acceptable; the plugins already reject SVG and Slack ignores what it can't render.

## Open Questions

- Should image-question messages set `suppress_unfurls` to reduce the URL-leak surface (the link preview), or is the in-block image enough? Default: leave unfurl handling as-is; revisit with the leak-proofing follow-up.
