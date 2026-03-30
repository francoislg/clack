## 1. EmojiCache

- [x] 1.1 Create `src/slack/emojiCache.ts` with `EmojiCacheEntry` type (`{ name, url, aliasFor? }`), `EmojiCache` interface (`search(query, limit?)`), and `createEmojiCache(client)` factory
- [x] 1.2 Implement lazy fetch via `emoji.list` API with alias resolution (follow `alias:name` chains to final URL) and 1-hour TTL (discard cache and re-fetch after expiry)
- [x] 1.3 Implement search with case-insensitive substring matching and `*` wildcard support (reuse matching logic from `usersCache.ts`)

## 2. find_emoji Tool

- [x] 2.1 Create `src/tools/query/findEmoji.ts` with `createFindEmojiTool(ctx, emojiCache)` following the `findUser.ts` pattern
- [x] 2.2 Define tool schema: `query` (string), `limit` (optional number, default 25). Return format: `{ emojis, total, truncated }`
- [x] 2.3 Register `find_emoji` in `src/tools/server.ts` `buildQueryTools()` — gated on `ctx.slackClient`, create `EmojiCache` alongside `UsersCache`

## 3. Tool Mapping

- [x] 3.1 Add `find_emoji` entry to `data/default_configuration/tool_mapping/clack.json`: `"find_emoji": "Looking up emoji \"{query}\""`

## 4. Verification

- [x] 4.1 Run `npx tsc` to verify no type errors
- [x] 4.2 Run `npm test` to verify no test regressions
