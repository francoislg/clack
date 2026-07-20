# Add Emoji Lore

## Why

Custom workspace emojis carry cultural meaning that their names don't expose — an emoji named after a person or an inside joke is invisible to `find_emoji`'s name-only matching, so Clack can't pick culturally-correct emojis (e.g. the team's canonical "approved" emoji for review sign-offs, or the meme emoji everyone uses when something breaks). Clack should be able to accumulate and use a workspace-specific dictionary of what emojis *mean* and *when they're used*.

## What Changes

- New **emoji lore store** (`data/state/emoji-lore.json`) — a dedicated durable dictionary, deliberately NOT the memory system (memory models live work that goes stale and its `recall` would be polluted by hundreds of dictionary entries). Each entry keys on emoji name and carries `meaning`, `tags[]`, up to 3 curated `examples` (paraphrased, each with an optional Slack permalink), and provenance (`taught` vs `observed`).
- New **`describe_emoji` write tool** — saves/updates a lore entry. Available in interactive contexts (so users can teach Clack) and to the casual-talk learner.
- **`find_emoji` enriched in place** — searches lore (meaning + tags) in addition to emoji names, merges/dedups results, and attaches `lore` to entries that have it. Claude never needs to know there are two systems.
- **Lore hints on message reading** — when `fetch_channel_messages` / `fetch_slack_message` results contain custom emojis with no lore entry, the tool result appends a one-line hint nudging Claude to capture the lore via `describe_emoji` if the surrounding conversation reveals it. Deterministic and selective: no hint when all seen emojis are already known.
- **Casual-talk integration** — engagement (Chatter) runs read the full compact lore index once per run (`find_emoji` with `lore_only: true` — name + meaning + tags, no examples/links) so emoji choice is a semantic match, not a search guess; runs are also instructed to observe reactions they encounter and distill new/corrected lore via `describe_emoji`.
- Lore examples paraphrase rather than quote, and never name the reacting user.

## Capabilities

### New Capabilities

- `emoji-lore`: The lore store (schema, persistence, graceful zod reader), the `describe_emoji` tool, the compact index rendering, and the unknown-emoji lore hints appended to message-reading tool results.

### Modified Capabilities

- `find-emoji-tool`: search extends to lore meaning/tags; results gain an optional `lore` field.
- `casual-talk-plugin`: engagement runs inline the lore index and gain an observe-and-distill instruction that writes lore via `describe_emoji`.

## Impact

- `src/slack/emojiCache.ts` — unchanged (remains the live-emoji source `find_emoji` joins against).
- `src/tools/query/findEmoji.ts` — merges lore matches into results.
- New `src/emojiLore.ts` (store) + `src/tools/query/describeEmoji.ts` (tool) + registration in `src/tools/server.ts` / `toolNameValidator.ts`.
- `src/tools/query/fetchChannelMessages.ts` / `fetchSlackMessage.ts` — append the unknown-emoji lore hint when fetched messages carry custom emojis without lore.
- `src/plugins/casual-talk/engagement.ts` — prompt gains lore index + observation instruction. Lore access flows through the plugin SDK (new small surface or prompt-injection by core), respecting the plugin boundary.
- No config flag needed: an empty lore store is inert (find_emoji behaves exactly as today).
