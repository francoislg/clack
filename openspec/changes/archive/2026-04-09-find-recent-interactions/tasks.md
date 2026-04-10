## 1. Tool Implementation

- [x] 1.1 Create `src/tools/query/findRecentInteractions.ts` with the tool definition and session-scanning logic
- [x] 1.2 Implement privacy filter: include sessions from public channels (C-prefix) and the calling user's own DMs; exclude G-prefixed channels
- [x] 1.3 Implement `type` parameter filtering (`all` | `dm` | `public_channels`) applied after privacy enforcement
- [x] 1.4 Implement keyword search: case-insensitive substring match across `originalQuestion`, `refinements[]`, and `lastAnswer`
- [x] 1.5 Implement sorting by `createdAt` descending, then apply `offset` and `limit`
- [x] 1.6 Return full session objects per the result format: `sessionId`, `channelName`, `triggerType`, `userId`, `displayName`, `createdAt`, `question`, `refinements`, `answer`
- [x] 1.7 Write tests in `src/tools/query/findRecentInteractions.test.ts` covering: keyword match, privacy filter, type filter, pagination, empty results

## 2. Tool Registration

- [x] 2.1 Import and register `createFindRecentInteractionsTool` in `src/tools/server.ts` inside `buildQueryTools`, available to all roles (no role gate)

## 3. Prompt Update

- [x] 3.1 Add context recovery hint to the `directMessages` branch in `buildDeliveryContext` in `src/claude/promptBuilder.ts`
- [x] 3.2 Add the same context recovery hint to the `mentions` branch
