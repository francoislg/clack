## 1. Channel Cache Infrastructure

- [x] 1.1 Create `src/slack/channelCache.ts` with `ChannelInfo` interface (`id`, `name`), in-memory `Map<string, ChannelInfo>`, `getChannelInfo(client, channelId)` function, and error handling (log + return undefined)
- [x] 1.2 Add tests for `channelCache.ts` — cache miss (API call), cache hit (no API call), API error returns undefined

## 2. Session Integration

- [x] 2.1 Add `channelName?: string` to `SessionContext` in `src/sessions.ts`
- [x] 2.2 Resolve channel name in `setupSession()` in `src/slack/handlers/core.ts` via `getChannelInfo`, store on session

## 3. Prompt Builder

- [x] 3.1 Add channel name line to `buildDeliveryContext()` in `src/claude/promptBuilder.ts` — `"- Channel: #name"` for all trigger types except `directMessages`
- [x] 3.2 Replace raw channel ID with name in assistant panel context (line referencing `assistantCurrentChannelId`)
- [x] 3.3 Update prompt builder tests for channel name inclusion and DM exclusion

## 4. Pre-Analysis

- [x] 4.1 Resolve channel name in `autoRespond.ts` pre-analysis block via `getChannelInfo` and pass to `runPreAnalysis`
- [x] 4.2 Add `channelName` parameter to `runPreAnalysis` signature and include `Channel: #name` in the classifier prompt
- [x] 4.3 Update pre-analysis tests for channel name in prompt

## 5. MCP Tools

- [x] 5.1 Add `channel_name` to `fetch_channel_messages` result object via `getChannelInfo`
- [x] 5.2 Add `channel_name` to `fetch_slack_message` result object via `getChannelInfo`
- [x] 5.3 Update tool tests for `channel_name` in results

## 6. Verification

- [x] 6.1 Run `npx tsc --noEmit` — type-check passes
- [x] 6.2 Run `npm test` — all tests pass
