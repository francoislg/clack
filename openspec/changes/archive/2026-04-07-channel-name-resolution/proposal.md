## Why

Channel IDs are opaque throughout the system. Claude never knows whether it's in `#security-compliance` or `#random`, which affects response quality. Pre-analysis classifiers can't use channel context for relevance decisions. MCP tools return raw channel IDs that Claude can't interpret. Admins see channel IDs in the Home Tab instead of names.

## What Changes

- Add a channel info cache (`channelCache.ts`) that resolves Slack channel IDs to names via `conversations.info`, with in-memory caching matching the `userCache.ts` pattern
- Resolve the channel name during session creation and store it on the session
- Include channel name in the delivery context prompt for all non-DM triggers
- Include channel name in the pre-analysis classifier prompt
- Enrich MCP tool results that return channel IDs with the resolved channel name (`fetch_channel_messages`, `fetch_slack_message`)
- Replace raw channel IDs with names in the assistant panel delivery context

## Capabilities

### New Capabilities
- `channel-context`: Channel name resolution cache and injection into Claude's context (sessions, prompts, tools)

### Modified Capabilities
- `auto-respond-pre-analysis`: Pre-analysis classifier receives the channel name as context; spec updated to match current implementation (Sonnet model, fail-closed, attributed history)

## Impact

- `src/slack/channelCache.ts` — new file
- `src/sessions.ts` — `SessionContext` gains `channelName?: string`
- `src/slack/handlers/core.ts` — `setupSession()` resolves channel name
- `src/claude/promptBuilder.ts` — `buildDeliveryContext()` includes channel name
- `src/slack/handlers/autoRespond.ts` — pre-analysis block includes channel name
- `src/tools/query/fetchChannelMessages.ts` — result includes `channel_name`
- `src/tools/query/fetchSlackMessage.ts` — result includes `channel_name`
- Additional Slack API call (`conversations.info`) per unique channel, cached for process lifetime
