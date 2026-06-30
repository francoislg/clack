## Why

Casual-talk's only move on a hit is to post a message, which is high-touch and can read as noisy. Emoji reactions are a lighter, more natural way for the bot to feel present in a channel — acknowledging a win, a joke, or an announcement without adding a message. The reaction plumbing (`add_reaction`, `find_emoji`) already exists and is available in the casual-talk cron context; only the prompt directs Claude to never use it.

## What Changes

- On a casual-talk hit, Claude MAY now **react** to a recent message (via `add_reaction`) as an alternative — or complement — to posting. The three moves on a hit become non-exclusive: react only, post only, or react **and** post.
- **Reaction joinability is looser than posting.** A reactable message is any recent human message worth a lightweight acknowledgment (a win, a funny line, an announcement, a fresh human message) — a lower bar than the substantive-thread bar required to write a reply.
- Before reacting, Claude SHALL **search workspace emoji** (`find_emoji`) to discover custom emoji that fit the channel's character and the message, falling back to standard emoji.
- Emoji choice is **calibrated to the channel's character** — its config `promptSuggestion` hint plus its live Slack `purpose`/`topic`.
- **Volume is judgment-based, no hard cap** — focus on one or two messages per fire; when several related messages are active, a single emoji on the best one suffices rather than blanketing the channel.
- A **react-only** run terminates with `submit_response({ skip_response: true })` (the reaction is a tool side-effect; no `deliver_to`). A **react+post** run terminates with the single `deliver_to` entry. No new `submit_response` schema.
- `fetch_channel_messages` results gain a `channel_purpose` field so Claude sees channel character alongside messages in one call. This requires extending `getChannelInfo`/`ChannelInfo` (`src/slack/channelCache.ts`) — the cache backing `fetch_channel_messages`'s `channel_name` — to also read `purpose` from `conversations.info`.
- The persona constraint extends to reactions: reacting must never reveal the run was automation-triggered.

## Capabilities

### New Capabilities

(none — reuses the existing `reaction-tools` and `find-emoji-tool` capabilities unchanged)

### Modified Capabilities

- `casual-talk-plugin`: the **Prompt Assembly** requirement changes — the on-hit decision tree adds a reaction branch (react-only, post-only, or both), a looser reaction-joinability bar, an emoji-search-before-react step, channel-character emoji calibration, judgment-based volume guidance, and the react-only termination path. The persona constraint extends to reactions.
- `channel-context`: the **Channel Name in MCP Tool Results** requirement extends so `fetch_channel_messages` also surfaces `channel_purpose` when available.

## Impact

- **Code:** `src/plugins/casual-talk/prompt.ts` (new reaction branch + emoji-search + volume guidance), `src/slack/channelCache.ts` (extend `ChannelInfo`/`getChannelInfo` with `purpose`), `src/tools/query/fetchChannelMessages.ts` (surface `channel_purpose` in the result), and the corresponding test files.
- **Tools reused (no change):** `add_reaction`/`remove_reaction` (`reaction-tools`), `find_emoji` (`find-emoji-tool`) — already registered whenever a Slack client is present, which the casual-talk cron run has.
- **Config:** none — no new config fields, no second roll, same cadence/die.
- **Scopes:** `reactions:write` is already required by the existing reaction tools; `channels:read`/`conversations.info` for `purpose` is already used by the channel cache.
- **Behavior when no hit / no reactable message:** unchanged — a miss still skips, and a hit with nothing reactable and nothing worth posting still ends in a legitimate skip.
