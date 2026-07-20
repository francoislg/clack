# Tasks — harden-emoji-lore

## 1. Extraction hardening

- [x] 1.1 In `src/emojiLore.ts`, replace `EMOJI_TOKEN_PATTERN` with a boundary-aware pattern requiring a non-digit (or string edge) immediately before the opening colon and after the closing colon, and add an explicit all-numeric rejection inside `collectEmojiNames` — two independent rules, so they fail independently in tests
- [x] 1.2 Extend the `collectEmojiNames` tests in `src/emojiLore.test.ts`: `19:48:30` yields nothing, a full ISO timestamp yields nothing, leading `:50:` yields nothing, `nice :appywave: work` and a leading `:appywave: !` both yield `appywave`, hyphen/underscore/plus names still extract, and reaction-path extraction is unaffected
- [x] 1.3 Add a test documenting the accepted limitation: a shortcode flanked by a digit (`win2:tada:`) is not extracted — failing toward silence is the safe direction for an advisory hint

## 2. Lore deletion

- [x] 2.1 Add `clearLore(name: string): Promise<boolean>` to `src/emojiLore.ts` — normalizes the name, deletes through the serialized write chain, returns whether an entry was present (absence is not an error)
- [x] 2.2 Unit tests: deletes an existing entry, deletes a `taught` entry (provenance guard does not apply), returns false for an absent name without throwing, normalizes `:Ship_It:` → `ship_it`, and a delete followed by a re-read shows the entry gone
- [x] 2.3 In `src/tools/query/describeEmoji.ts`: add `clear?: boolean`, make `meaning` optional in the schema, branch to `clearLore` when `clear` is true, and return an error result naming `meaning` when a non-clear call omits it. Thread `clearLore` through `DescribeEmojiDeps` so it is injectable like `upsertLore`
- [x] 2.4 Update the tool description — state that `clear: true` removes an entry and that clearing is for when a PERSON asks, not an autonomous move during observation
- [x] 2.5 Tool tests: clear deletes (asserting `clearLore` called with the normalized name and `upsertLore` NOT called), clear on an absent entry succeeds, clear ignores supplied `meaning`/`tags`, non-clear without `meaning` errors and mutates nothing, and the existing upsert paths still pass unchanged

## 3. Provenance in results

- [x] 3.1 In `src/tools/query/findEmoji.ts`, extend the `withLore` projection to include `source` and `updatedAt`; leave `toCompactLore` untouched
- [x] 3.2 Tests: full results carry both fields with the right values; `lore_only` results still have exactly `name`/`meaning`/`tags`; empty-store legacy parity still holds (no `lore` key at all)

## 4. Curation queries

- [x] 4.1 Add `missing_lore?: boolean` to `find_emoji`: iterate the query's cache matches, exclude any name present in the lore store, return `emojis` as a plain `string[]` with the shared index-read default limit and standard `total`/`truncated`
- [x] 4.2 Add `sort?: "oldest"`: when paired with `lore_only`, order the compact index by `updatedAt` ascending BEFORE applying the limit; leave `toCompactLore`'s key set untouched
- [x] 4.3 Enforce the two illegal combinations as error results — `lore_only` + `missing_lore` together, and `sort` without `lore_only` — each naming the conflict
- [x] 4.4 Update the tool description to cover both curation modes and their pairing rules
- [x] 4.5 Tests: missing-lore listing (names only, no urls/lore objects), narrowing by query, empty when all documented, everything when the store is empty; oldest-first ordering, ordering-before-truncation, compact keys unchanged, default order preserved without `sort`; both conflict errors; and the existing `lore_only`/legacy-parity tests still pass unchanged

## 5. Verification

- [x] 5.1 `npx tsc --noEmit`, `npm test`, `npx oxlint` + `npx oxfmt` on touched files
- [x] 5.2 `openspec validate harden-emoji-lore --strict`
