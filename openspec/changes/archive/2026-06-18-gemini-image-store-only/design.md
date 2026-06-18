# Design

## Context

`generate_image` shipped posting its result to a channel. This change reorients it around Slack's `slack_file` image-block source so the generated image becomes a referenceable handle rather than an immediately-posted file. Three capabilities ripple: the plugin's delivery contract, the curated block validator, and the delivery-context prompt.

## Decision 1: `image_url` and `slack_file` are distinct mechanisms, not access levels

A Block Kit `image` block has two mutually exclusive source fields:

```
image_url:  Slack's image proxy fetches the URL ANONYMOUSLY (no token).
            → must be publicly reachable HTTPS; Slack downloads + re-hosts it.
            → a Slack url_private here fails (proxy gets 403).

slack_file: references a file Slack ALREADY OWNS, by `id` or by `url`
            (its url_private/permalink). No proxy fetch — Slack resolves it
            internally and checks the POSTING identity has access.
            → renders a private/unshared file with no public exposure.
```

So the split is **"external URL Slack must fetch"** vs **"a file already inside Slack."** A private Slack file has no public form short of `files.sharedPublicURL` (which mints a separate public artifact and is often disabled). Within `slack_file`, `{ url }` (the `url_private`/`permalink`) and `{ id }` are two handles to the **same** file; across the two block fields they are not interchangeable. Supplying both `image_url` and `slack_file`, or both `id` and `url` inside `slack_file`, is rejected by Slack — so Clack rejects it at the tool boundary with an actionable error.

**Access caveat:** the identity that *uploads* the file and the identity that *posts* the block must match. Clack's bot does both, so this holds automatically; it would only break under a user-token-upload / bot-token-post split, which does not occur here.

## Decision 2: store-only delivery, handle-only return

The tool uploads via `files.uploadV2` with **no `channel_id`** (file owned by the bot, shared nowhere) and returns `{ fileId, permalink }`. Rationale:

- One delivery path that works in every context (DM, channel, channelless) — no `channel` arg, no "can't post here" branch.
- Claude composes the image into its own `submit_response` via `slack_file: { id: fileId }`, instead of a bare file appearing in the channel ahead of the message.
- **Handle-only (no inline bytes).** The prior `data`/`both` modes returned the image inline for Claude to inspect. We drop that: Claude renders blind, and the refine-before-show loop is preserved structurally by editing (`input_image_url` ← previous `permalink`) rather than inline inspection. This keeps the result envelope small and the tool single-purpose. (Trade-off: Claude cannot visually self-check a result before rendering. Accepted — the cost of a bad render is one follow-up edit, and inline-inspect added a second delivery mode whose only consumer was a rare refine path.)

## Decision 3: `AuthoredImageBlock` — authored shape vs `@slack/types`' strict union

`@slack/types` models `ImageBlock` as `Block & (UrlImageObject | SlackFileImageObject)` — a strict union where exactly one source is *type-level* required. Clack's curated zod schema keeps both `image_url` and `slack_file` **optional** (so either variant parses) and enforces the exactly-one-of rule at validation time, which yields a friendlier, aggregated error than a zod union failure. That looser inferred shape is not assignable to Slack's strict `ImageBlock`, and the `submit_response` schemas are explicitly typed (`z.ZodType<MessagePayload>` / `z.ZodType<Action>`), so the inferred block type must satisfy `Block`.

Resolution: introduce a local `AuthoredImageBlock` (optional `image_url`, optional `slack_file: { id?; url? }`, required `alt_text`) and use it in the curated `Block` union in place of `@slack/types`' `ImageBlock`. This mirrors the existing `AuthoredTableBlock` precedent (authored shape looser than Slack's post-normalization shape, runtime validator enforces the constraint). No production code reads `.image_url` off a curated `Block` after narrowing, so widening it to optional is safe.

## Decision 4: remove the direct-post thread hint outright

`delivery-context`'s "Thread Timestamp Surfaced for Direct-Posting Tools" requirement existed solely so `generate_image`'s channel upload could thread itself. With store-only delivery nothing posts directly to Slack, so the hint is dead prompt surface and is removed rather than left to mislead Claude about a `thread_ts` no tool consumes.

## Risks / trade-offs

- **`webp` not renderable via `slack_file`.** Slack supports only png/jpg/jpeg/gif here. Gemini emits png, so the generated path is fine; noted so nobody wires a webp source expecting it to render.
- **Workspace file-access settings.** `slack_file` rendering relies on the bot having access to the file it uploaded — true by construction. No dependency on public file sharing being enabled.
- **Behavioral break for the old `deliver` arg.** Acceptable: the only caller is Claude, re-steered by the rewritten usage instruction; no persisted state encodes the old modes.
