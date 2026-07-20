# Harden Emoji Lore

## Why

Two days of production observation on the shipped `add-emoji-lore` feature surfaced one defect and one structural gap.

**The defect:** `collectEmojiNames` extracts `:name:` tokens with `/:([a-z0-9_+-]+):/gi`, which allows digits — so every clock time and ISO timestamp in a message produces bogus candidate names. A scan of real sessions found the extraction output dominated by `:50:`, `:51:`, `:49:`, `:17:`, `:00:` and similar fragments of strings like `19:48:30`. No bad hint has reached Claude, because the `EmojiCache` intersection filters unknown names — but that means the cache is doing 100% of the filtering, the spec's claim that extraction drops malformed tokens is false, every fetch burns dozens of pointless lookups, and the day a workspace adds a digit-named or common-word custom emoji, timestamps begin producing real false hints permanently.

**The gap:** lore can only be created, never removed. `describe_emoji` upserts; correcting an entry requires asserting a `taught` meaning over it; deleting a junk entry requires hand-editing `data/state/emoji-lore.json` on the VM. Combined with a hint that prompts creation on every message read, the store is a one-way ratchet — and the design's stated mitigation for wrong `observed` lore ("auditable and correctable") is currently neither.

## What Changes

- **Fix `collectEmojiNames` extraction** — reject all-numeric tokens and require non-digit boundaries around the delimiting colons, so `19:48:30` yields nothing while `nice :appywave: work` still yields `appywave`. The `EmojiCache` intersection stays as the authoritative filter; this makes the regex an honest pre-filter rather than a pass-through.
- **`describe_emoji` gains `clear: true`** — deletes the entry for `name`, making `meaning` conditionally optional. Reuses the established `clear` idiom from `set_idler_sync_hours` rather than adding a fourth emoji tool. A clear is exempt from the taught-wins provenance guard (that guard exists to prevent *silent overwrite*; a clear is explicit) and is instruction-scoped to human-initiated requests.
- **Expose `source` and `updatedAt` in `find_emoji` results** — both are stored today but never returned, so Claude cannot tell a human "this is a three-week-old guess, want to confirm it?". Full (non-`lore_only`) results carry them; the compact `lore_only` projection stays lean.
- **`find_emoji` gains two curation queries** — `missing_lore: true` returns workspace emoji that have NO lore (the worklist for filling the dictionary), and `sort: "oldest"` orders the `lore_only` index by least-recently-updated (the worklist for re-checking it). Today `find_emoji` can only answer "help me pick an emoji"; neither curation question — *what's undocumented?* and *what's gone stale?* — is expressible at all.

## Capabilities

### New Capabilities

_None — this hardens an existing capability._

### Modified Capabilities

- `emoji-lore`: extraction rules tightened (numeric/boundary rejection); `describe_emoji` gains a delete path with its own provenance rule.
- `find-emoji-tool`: full results carry `source` and `updatedAt` alongside `meaning`/`tags`/`examples`; two additive curation modes (`missing_lore`, `sort: "oldest"`).

## Impact

- `src/emojiLore.ts` — `EMOJI_TOKEN_PATTERN` + `collectEmojiNames`; new `clearLore(name)`.
- `src/tools/query/describeEmoji.ts` — `clear` arg, conditional `meaning`, delete branch.
- `src/tools/query/findEmoji.ts` — `withLore` projection gains two fields; `missing_lore` and `sort` args with their branches.
- Tests for all three, plus the timestamp-rejection cases the current suite lacks.
- No migration: the store shape is unchanged and no persisted data is reinterpreted.
