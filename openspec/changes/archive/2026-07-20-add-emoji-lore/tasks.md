# Tasks — add-emoji-lore

## 1. Lore store

- [x] 1.1 Create `src/emojiLore.ts`: `EmojiLoreEntry` type + **graceful** zod entry schema per repo convention (`.default()` on every field, no `.strict()`, no enum-rejection, no date-coercion — a legacy/partial entry must load, not wipe), `createRecordStore` over `data/state/emoji-lore.json`, injected deps (`readFile`/`writeFile`/`mkdir`/`fileExists`/`now`) with `set*/reset*Deps` + live-binding closure, module-level `writeChain` serializer (memoryRegistry idioms)
- [x] 1.2 Store API: `getLore(name)`, `listLore()`, `upsertLore(input)` implementing the provenance rule (observed→taught BLOCKED returning the existing entry + conflict flag; taught→anything, observed→observed APPLIED), `updatedAt` stamped from the injected clock, `clearEmojiLoreCache()` for tests
- [x] 1.3 `toCompactLore(entry)` → `{ name, meaning, tags }` exactly (drops examples, source, updatedAt)
- [x] 1.4 `collectEmojiNames(messages)` → `Set<string>` (reactions `.emoji` + `/:([a-z0-9_+-]+):/gi` text tokens, deduped) and `buildLoreHint(names, emojiCache)` → `string | null` (cache-intersect, unknown-only, ≤5 names + overflow count, optional phrasing)
- [x] 1.5 Unit tests `src/emojiLore.test.ts`: missing file → empty, quarantined bad entry non-fatal, all four provenance combinations, `updatedAt` from fake clock, compact form key-exact, `collectEmojiNames` extraction/dedup/malformed-token rejection, `buildLoreHint` null-when-all-known / null-when-no-custom / cap+overflow

## 2. EmojiCache membership

- [x] 2.1 Add `has(name: string): Promise<boolean>` to the `EmojiCache` interface + `createEmojiCache` impl — exact-name lookup over the same lazy-fetched, TTL'd list (build a `Set`/map once per fetch rather than scanning)
- [x] 2.2 Tests in `src/slack/emojiCache.test.ts` (create if absent): exact hit, substring is NOT a hit (`partyparrot` present ⇏ `has("party")`), no extra `emoji.list` call when cache is warm

## 3. describe_emoji tool

- [x] 3.1 Create `src/tools/query/describeEmoji.ts`: zod args (`name`, `meaning`, `tags?`, `examples?` max 3, `source`), arg docs stating examples must be paraphrased and must not name the reactor, `emojiCache.has(name)` → warn-but-save, conflict result returns the existing taught entry with a surface-the-discrepancy message
- [x] 3.2 Register in `src/tools/server.ts` inside the `if (ctx.slackClient)` block beside `createFindEmojiTool`, and add `"describe_emoji"` to the Slack-client-gated group in `src/tools/toolNameValidator.ts`
- [x] 3.3 Unit tests: taught save, observed-over-taught blocked with discrepancy message, taught-over-observed replaces, 4-example schema rejection, unknown-emoji warning

## 4. find_emoji enrichment

- [x] 4.1 Extend `createFindEmojiTool` with a lore dependency (default-injected, per `createRememberTool`): lore-haystack match (`name + meaning + tags`, case-insensitive substring), merge/dedup with name matches, lore-first ranking, `lore` attached to every result that has it, skip lore whose name fails `emojiCache.has`
- [x] 4.2 Add `lore_only?: boolean`: compact-form listing restricted to lore-bearing emojis, still honoring a narrowing query (`*` = all), default limit 200 (vs 25), standard `total`/`truncated`
- [x] 4.3 Unit tests `src/tools/query/findEmoji.test.ts` (create): lore match on tag, dedup + lore-first ranking, lore attached to a name match, deleted-emoji lore skipped, EMPTY-STORE LEGACY PARITY (result shape byte-identical to today, no `lore` keys), `lore_only` filtering + default limit + truncation

## 5. Lore hints on message-reading tools

- [x] 5.1 Wire `collectEmojiNames` + `buildLoreHint` into `src/tools/query/fetchChannelMessages.ts` result assembly as an optional top-level `lore_hint` field (spread-when-present; never mutate message text)
- [x] 5.2 Same wiring in `src/tools/query/fetchSlackMessage.ts`
- [x] 5.3 Tests in both tools' existing test files: hint present for an unknown custom emoji (reaction path AND text path), absent when all known, absent when only standard emojis

## 6. Casual-talk engagement

- [x] 6.1 Update the reacting paragraph in `src/plugins/casual-talk/engagement.ts`: once-per-run `find_emoji` with `lore_only: true` index read + semantic-match guidance, keeping the existing name-search/standard-emoji fallback
- [x] 6.2 Add the observe-and-distill clause (`describe_emoji`, `source: "observed"`, paraphrased example + permalink, surface-don't-overwrite on taught contradictions) and the best-effort clause (lore failure never aborts the run)
- [x] 6.3 Update `engagement.test.ts` assertions for the new clauses; confirm `prompt.test.ts`'s "no find_emoji in the cron prompt" assertion still holds

## 7. Verification

- [x] 7.1 `npx tsc`, `npm test`, `npx oxlint` + `npx oxfmt` on touched files
- [x] 7.2 `openspec validate add-emoji-lore --strict`
