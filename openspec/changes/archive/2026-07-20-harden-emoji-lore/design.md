# Design — harden-emoji-lore

## Context

`add-emoji-lore` shipped and has been running in production. Observation of real sessions produced two findings.

The extraction regex `/:([a-z0-9_+-]+):/gi` in `collectEmojiNames` (`src/emojiLore.ts`) allows digits, so timestamps match. Real session data shows the top extracted "emoji names" are `:50:`, `:51:`, `:49:`, `:52:`, `:17:` — fragments of times like `19:48:30` — ahead of any genuine emoji. Genuine shortcodes in message text do exist (`:red_circle:`, `:rotating_light:`, `:pr-open:`, `:happy_dance:`) and are mostly standard emoji; custom ones are a thin but real trickle. Reactions carry the workspace's custom set (`appywave`, `appy-oh-no`, `chefs-kiss`) but appear rarely in what the bot reads.

Separately, the store has no subtraction path: `upsertLore` is the only mutation, so a wrong `observed` entry is permanent unless someone overwrites it with a `taught` meaning or edits JSON on the VM.

## Goals / Non-Goals

**Goals:**

- Extraction rejects timestamp/numeric noise before it reaches the cache lookup.
- Lore can be deleted through the same tool that creates it.
- A human (via Claude) can see how old a lore entry is and where it came from.

**Non-Goals:**

- **No re-surfacing / staleness hint.** Tuning a re-check interval over a store that is currently empty would be guessing. Deferred until there is lore to re-check.
- **No bootstrap-from-`emoji.list` seeding pass.** Deliberately ordered after this change — bulk-seeding into a store with a noisy extractor and no delete path is the worst possible sequence.
- No change to the store file shape, the provenance rule for writes, or the hint's trigger condition (still unknown-custom-emoji only).

## Decisions

### D1: Tighten extraction, keep the cache as the authority

Two independent rules, both required:

1. **Non-digit boundaries.** The character before the opening colon and after the closing colon must not be a digit — or must be absent, at a string edge. Expressed as lookarounds (`(?<![0-9])…(?![0-9])`) so a zero-width edge satisfies them and a leading `:appywave:` still matches. This is what kills `19:48:30`: the `:48:` candidate is digit-flanked on both sides.
2. **Reject all-numeric names.** A token like `:50:` at the start of a string has no preceding character and would survive rule 1; no custom emoji is purely numeric, so rejecting them outright is safe and closes the gap.

Implemented as a boundary-aware regex plus an explicit numeric guard in the loop, not one clever pattern — the two rules have different reasons and should fail independently in tests.

The `EmojiCache` intersection stays exactly as-is. It remains the authoritative filter (only the workspace's real emoji list can say what is custom); this change just stops feeding it garbage.

*Alternative rejected:* dropping the text path entirely and relying on reactions only. Session data shows text carries genuine custom shortcodes (`:pr-open:`, `:happy_dance:`), and reactions are rarer in the bot's field of view than the original design assumed — text is the larger surface, not the smaller one.

### D2: `clear: true` on `describe_emoji`, not a separate `forget_emoji`

Reuses the `clear` idiom already established by `set_idler_sync_hours`. Rationale: one fewer tool in an already-broad toolbelt, and Claude already reaches for `describe_emoji` when the subject is emoji meaning.

Schema shape: `meaning` becomes optional at the zod level, with the handler enforcing the pairing — `clear: true` requires `name` only; `clear` absent/false requires `meaning`. Validating in the handler rather than via a zod refinement keeps the error message specific and keeps `inputSchema.meaning` independently assertable in tests (the pattern the existing `describe_emoji` tests use for `examples`/`source`).

Clearing a name with no entry is a **success, not an error** — the caller's intent ("this should not be in the dictionary") is already satisfied, and a hard error would push Claude into defensive read-before-delete calls.

### D3: A clear bypasses the taught-wins guard, and is instruction-scoped instead

The provenance guard exists to stop a machine inference from **silently overwriting** a human's stated meaning. A clear is not silent — it is a deliberate, targeted removal, and it is the only escape hatch for lore that is wrong rather than merely outdated. Applying the guard to clears would leave bad `taught` entries permanently undeletable, which is the exact ratchet this change exists to break.

The protection moves to the instruction layer instead: the tool description states that clearing is for when a **person asks** for an entry to be removed, and is not an autonomous move during observation. This is the same trust model the feature already uses for the paraphrase/no-attribution rules on examples.

*Alternative rejected:* requiring `source: "taught"` to clear taught lore. It reads as a safety mechanism but isn't one — Claude chooses `source` freely, so it is a speed bump that mostly generates confusing failures.

*Accepted risk:* Claude could clear lore unprompted. Bounded by the store being small, rebuildable, and covered by the daily `data/state` backup.

### D4: `source`/`updatedAt` on full results only

`withLore` gains both fields, so a normal `find_emoji` result becomes `lore: { meaning, tags, examples, source, updatedAt }`. This is what makes an entry auditable — "observed, 3 weeks ago" is the difference between trusting it and re-checking it.

The `lore_only` compact projection stays `{ name, meaning, tags }`. Its entire purpose is a cheap whole-index read for emoji *selection*, where provenance is irrelevant; adding two fields per entry to a 200-entry payload taxes the one path that is deliberately lean. D5's `sort: "oldest"` is what reconciles this with staleness work — ordering by `updatedAt` does not require *returning* it.

This widens the empty-store legacy-parity contract not at all — `withLore` still attaches nothing when an emoji has no lore.

### D5: Two curation queries on `find_emoji`, not a new tool

`find_emoji` today answers one question — *which emoji fits this message?* Curation asks two others that are currently inexpressible: **what has no lore yet?** and **what lore is stalest?** Both are answered by the exact join `find_emoji` already performs (workspace emoji list ⋈ lore store), so they belong here; rebuilding that join in a separate tool would be the real duplication.

**`missing_lore: true`** returns the names of workspace emoji with NO lore entry, honoring `query` for narrowing (`"*"` = all). Its payload is a **plain `string[]`**, not objects — a name is the entirety of the useful information, and a worklist can run to a few hundred entries where halving the tokens matters. It shares `lore_only`'s larger default limit, since both are index reads rather than searches.

**`sort: "oldest"`** orders the `lore_only` index by `updatedAt` ascending. Claude reads the first N as the stalest entries; when it needs an actual date it does a normal lookup on that one emoji, which carries `updatedAt` per D4. This is the deliberate compromise: **the sort key does not have to be in the payload to be useful**, so the compact projection stays lean while staleness triage becomes possible.

Both are additive — `lore_only`'s existing shape and semantics are untouched, so casual-talk's live engagement instructions keep working without an edit.

Conflict handling is explicit rather than silently-resolved, because a silently-ignored argument teaches Claude the wrong contract:

- `lore_only` + `missing_lore` together → error result (they are exact opposites).
- `sort` without `lore_only` → error result (there is no `updatedAt` to order by on the other paths).

*Alternative rejected:* widening `lore_only: boolean` into `lore: "with" | "without"`. Cleaner in the abstract, but it is a breaking change to an argument that is already named in shipped casual-talk instructions and in the live tool description — a rename with no behavioral gain.

*Note on sequencing:* these two queries are the enablers for both deferred items in Non-Goals. `missing_lore` is the worklist a bootstrap-from-`emoji.list` pass would iterate; `sort: "oldest"` is how staleness re-checking gets driven on demand instead of via a hint that nags. Shipping the primitives first keeps both options open at a fraction of the cost.

## Risks / Trade-offs

- [Boundary rule rejects a legitimate emoji adjacent to a digit, e.g. `win2:tada:`] → Vanishingly rare in practice (emoji are whitespace-delimited in real messages) and it fails toward silence, which is the safe direction for an advisory hint. Covered by a test documenting the accepted limitation.
- [Claude clears lore it should have kept] → D3's accepted risk; bounded by backups and the instruction scoping.
- [Two more fields per lore-bearing `find_emoji` result] → Only on the non-compact path, which is already limited to 25 results by default.
- [`missing_lore` on a large workspace returns hundreds of names] → Bounded by the same limit/`truncated` contract as every other mode, and the `string[]` payload keeps even a full page cheap.
- [Four boolean/enum args on one tool invite invalid combinations] → The two illegal pairs return explicit error results naming the conflict, so a wrong call is corrected on the next turn rather than silently doing something unintended.

## Migration Plan

Purely additive plus one narrowing of an internal regex. No stored data changes meaning; no migration. Rollback is reverting the code — the store file is untouched by this change.

## Open Questions

None blocking. The deferred items (staleness re-surfacing, `emoji.list` bootstrap) are tracked in Non-Goals and gated on production data from the current build.
