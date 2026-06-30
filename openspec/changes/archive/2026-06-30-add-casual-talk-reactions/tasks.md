## 1. Surface channel purpose in fetch_channel_messages

- [x] 1.1 In `src/slack/channelCache.ts`, add an optional `purpose?: string` to the `ChannelInfo` interface and populate it in `getChannelInfo` from `result.channel.purpose?.value`, only when non-empty (empty string → omit)
- [x] 1.2 Update `src/slack/channelCache.test.ts`: assert `getChannelInfo` returns `purpose` when `conversations.info` carries a non-empty purpose, and omits it for empty/missing purpose
- [x] 1.3 In `src/tools/query/fetchChannelMessages.ts`, surface the resolved `channelInfo.purpose` as an optional `channel_purpose` field on the result (alongside `channel_name`), omitted when absent
- [x] 1.4 Update `src/tools/query/fetchChannelMessages.test.ts`: assert `channel_purpose` is present when the channel has a purpose, and omitted when it has none or resolution fails

## 2. Add the reaction branch to the casual-talk prompt

- [x] 2.1 In `src/plugins/casual-talk/prompt.ts`, extend the on-hit section so the positive moves are non-exclusive: react-only, post-only, or react-and-post (Step 2/Step 3)
- [x] 2.2 Add the looser reaction-joinability guidance (reactable = recent human message worth a lightweight ack: win, joke, announcement, fresh human message) while reusing the existing human-leaf guard (never react to bot-leaf or the bot's own posts)
- [x] 2.3 Add the emoji-search step: instruct Claude to call `find_emoji` before reacting and calibrate the choice to the channel's `promptSuggestion` hint and `channel_purpose`, falling back to standard emoji
- [x] 2.4 Add judgment-based volume guidance: focus on one or two messages per fire; when several related messages are active, a single emoji on the best one suffices; no fixed numeric cap
- [x] 2.5 Add the react-only termination instruction (`add_reaction` call(s) then `submit_response({ skip_response: true })`, no `deliver_to`) and confirm react-and-post ends with the single `deliver_to` entry
- [x] 2.6 Extend the persona constraint so reactions, like posts, never reveal the roll/schedule/automation
- [x] 2.7 Direct Claude to read each candidate channel's `channel_purpose` from `fetch_channel_messages` when present

## 3. Tests

- [x] 3.1 Update `src/plugins/casual-talk/prompt.test.ts` with assertions for the new prompt scenarios: reaction is offered as an on-hit move, the three non-exclusive moves are stated, looser reaction bar + human-leaf guard, emoji-search-before-react + channel-character calibration, judgment-based volume (no numeric cap), and react-only `skip_response` termination
- [x] 3.2 Verify the existing casual-talk prompt scenarios still pass (die size, candidate channels, fallback topics, deliver_to-not-post_to, no-reveal)

## 4. Verify

- [x] 4.1 Run `npx tsc` (type-check), `npx oxlint` on changed files, and `npm test` for the touched suites
- [x] 4.2 Run `openspec validate add-casual-talk-reactions --strict` and resolve any issues
