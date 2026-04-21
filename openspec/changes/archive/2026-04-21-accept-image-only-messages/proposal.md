## Why

Image support landed in `slack-image-support`, but the handler-level text guards that predate it still block messages with no caption. A DM, @mention, or reaction on an image-only post never reaches `processMessage` — Clack rejects the message before the image extraction pipeline can do anything with it. Users asking Clack to look at a screenshot without typing a caption (the natural case) get silently ignored or see "Sorry, I couldn't read the message."

## What Changes

- Remove the `!text` short-circuit in DM, @mention (top-level), and reaction handlers when extracted image files are present. Route image-only messages through `processMessage` with a synthesized fallback prompt that tells Claude to look at the image.
- In thread auto-respond, stop dropping empty-text messages. When a thread reply has no text but has images, synthesize a `[image: filename (file_id: XXX)]` placeholder as the message text for pre-analysis so it can still return `respond`/`skip`/`stop` using thread history as context.
- Add per-trigger fallback prompt text (e.g., "Answer based on the attached image(s).") so Claude receives a minimal user-turn when text is absent.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `slack-message-trigger`: DM and @mention handlers accept image-only messages instead of dropping them when text is empty.
- `slack-reaction-trigger`: Reactions on image-only messages trigger a response instead of posting "couldn't read the message."
- `auto-respond-pre-analysis`: Thread reply pre-analysis runs for empty-text messages when image files are present, using synthesized image metadata as the message text.

## Impact

- **Handlers**: `src/slack/handlers/assistant.ts`, `src/slack/handlers/mention.ts`, `src/slack/handlers/newQuery.ts`, `src/slack/handlers/autoRespond.ts`
- **No new dependencies, no new data directories, no Slack scope changes** — image extraction already works, only the gates change.
- **Behavior change**: previously silent paths now generate responses. A user who reacts `:clack:` to an unrelated image in a channel will now get a reply, where today they would not. Mitigated by the existing `view_slack_image` on-demand model (Claude still chooses whether to download) and by pre-analysis for auto-respond threads.
- **Tests**: existing handler tests for empty-text behavior need updates to reflect the new image-aware gates.
