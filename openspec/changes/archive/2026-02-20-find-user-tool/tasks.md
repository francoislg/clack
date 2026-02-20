## 1. UsersCache Abstraction

- [x] 1.1 Create `src/slack/usersCache.ts` with `SlackUserEntry` interface, `UsersCache` interface, and `createUsersCache(client)` factory function
- [x] 1.2 Implement paginated `users.list` fetch inside the cache, filtering out deleted users, bots, and USLACKBOT
- [x] 1.3 Implement `search(queries, limit?)` with case-insensitive substring matching across userId, username, and displayName, with deduplication and result limiting

## 2. Thread Slack Client to Tool Context

- [x] 2.1 Add optional `slackClient` field to `QueryToolContext` in `src/tools/types.ts`
- [x] 2.2 Add optional `slackClient` to `BuildQueryContextParams` and pass it through in `src/tools/context.ts`
- [x] 2.3 Add optional `slackClient` to `AskClaudeOptions` in `src/claude.ts` and pass it to `buildQueryContext`
- [x] 2.4 Pass `client` as `slackClient` from `processMessage` in `src/slack/handlers/core.ts` to `askClaude`

## 3. find_user Tool

- [x] 3.1 Create `src/tools/query/find_user.ts` with `createFindUserTool(ctx, usersCache)` following the existing tool pattern (Zod schema, JSON response)
- [x] 3.2 Register `find_user` in `buildQueryTools` in `src/tools/server.ts`, conditionally on `ctx.slackClient` being present, available to all roles

## 4. Verify

- [x] 4.1 Run `npx tsc` to verify no type errors
- [ ] 4.2 Test by building and confirming the tool appears in Claude's available tools
