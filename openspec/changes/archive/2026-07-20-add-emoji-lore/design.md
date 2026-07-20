# Design — add-emoji-lore

## Context

`find_emoji` (src/tools/query/findEmoji.ts) matches only emoji *names* against the `EmojiCache` (src/slack/emojiCache.ts, 1h TTL over `emoji.list`). Culturally-loaded emojis — named after people, memes, or inside jokes — are unfindable by intent ("something for code approval"). The casual-talk engagement prompt already tells Claude to call `find_emoji` before reacting, so the discovery path exists; it just has nothing semantic to search.

The memory system (src/memoryRegistry.ts) was considered and rejected as the store: it models live work (staleAfter, nextSteps, reference recipes, archiving, daily review) and its `recall` substring search would be polluted by hundreds of dictionary-shaped entries. Emoji lore is a durable dictionary with a natural join to the live emoji list — a different animal.

## Goals / Non-Goals

**Goals:**

- A durable, dedicated store of per-emoji lore: meaning, tags, curated examples, provenance.
- `find_emoji` becomes intent-searchable with zero new concepts for Claude to learn.
- A write path (`describe_emoji`) usable both by users teaching Clack conversationally and by casual-talk runs observing real usage.
- Casual-talk engagement runs pick emojis by semantic match against the full lore index.

**Non-Goals:**

- No automated reaction-mining pipeline (no event listeners, no evidence ring buffer) — observation is Claude-driven during engagement runs it already makes.
- No lore for standard Unicode emojis — custom workspace emojis only (the join target is `EmojiCache`).
- No per-channel lore scoping.
- No migration of any existing memory entries.

## Decisions

### D1: Dedicated store, not the memory system

`data/state/emoji-lore.json`, a record store keyed by emoji name, built on `createRecordStore` (same resilient per-entry-quarantine substrate as memory.json). Graceful zod reader per project convention. Writes serialized through a module-level chain (memoryRegistry pattern).

*Alternative rejected:* memory entries with an `emoji:` id prefix — recall pollution, dead fields (staleAfter/nextSteps/references), no join to the live emoji list, and the daily review would try to expire dictionary entries.

### D2: Entry shape

```ts
interface EmojiLoreEntry {
  name: string;                       // emoji name, no colons — the key
  meaning: string;                    // what it means / when it's used
  tags: string[];                     // free-text search hooks ("approval", "incident", "celebration")
  examples: Array<{ text: string; link?: string }>; // ≤3, paraphrased, never verbatim quotes
  source: "taught" | "observed";      // provenance; taught wins conflicts
  updatedAt: string;                  // ISO
}
```

- `examples[].text` is a paraphrase of the situation, never a quote, and never names the reactor. `link` is an optional Slack permalink (populated for observed lore — it's the receipt; resolvable later via `fetch_slack_message` for audit/self-correction). Links are store-only context: excluded from the compact index.
- No confidence score — `source` is the provenance signal; taught lore overrides observed (see D4).

### D3: Read path — enrich `find_emoji` in place

`createFindEmojiTool` gains a lore dependency. Search runs against BOTH:

1. emoji names via `EmojiCache.search` (existing wildcard/substring), and
2. a lore haystack per entry (`name + meaning + tags`, case-insensitive substring).

Results are merged and deduped by name; lore-matched entries rank first; every returned emoji that has lore carries it as `lore: { meaning, tags, examples }`. A lore entry whose emoji no longer exists in the workspace is skipped (the cache is the source of truth for what's postable) — the entry stays in the store untouched.

*Alternative rejected:* a separate `search_emoji_lore` tool — two tools for one question; Claude shouldn't have to know the storage split.

### D4: Write path — `describe_emoji` query tool

`src/tools/query/describeEmoji.ts`, registered for all roles in query contexts (culture is everyone's to teach — same altitude as adding a reaction). Args: `name`, `meaning`, `tags[]`, `examples[]` (≤3 enforced), `source`. Upsert by name.

Conflict rule: an `observed` write over a `taught` entry does not replace `meaning` — the tool returns the existing taught entry and instructs Claude to surface the discrepancy instead (a human said X; usage suggests Y). `taught` writes always win. This keeps a bad observation from silently overwriting a human's word.

The tool validates `name` against `EmojiCache` (warn-but-save if unknown, so lore can be taught right after an emoji is uploaded and before the 1h cache refresh). This requires a new `EmojiCache.has(name)` exact-membership method — `search` is substring-based, so `search("party")` would falsely report `party` as existing whenever `partyparrot` does. `has` shares the existing lazy-fetch + TTL path, so it costs no extra API call.

`describe_emoji` lives in `src/tools/query/` alongside `add_reaction`/`remove_reaction` — the established home for Slack-client-dependent write tools — not `src/tools/actions/`, which is reserved for intent-staging tools that become Slack buttons.

### D5: Casual-talk reads lore via a tool call, not prompt baking

Engagement instructions (src/plugins/casual-talk/engagement.ts) tell Claude to call **`find_emoji` with `query: "*"` and `lore_only: true`** (new optional arg: return only lore-bearing entries, compact form — name + meaning + tags, no examples/urls) once per engagement run, then pick reactions by semantic match against that index.

This adds a `lore_only` arg to the core `find_emoji` tool, but adds **no plugin-SDK surface**: casual-talk only names a core tool in its instruction text, which is the existing pattern (it already names `find_emoji`, `add_reaction`, `fetch_channel_messages`). The plugin import boundary is untouched — no plugin file imports lore code.

*Alternative rejected:* baking the index into the cron prompt at reconcile time. Lore changes on Clack's own writes, which would force a core→plugin change-notification path plus re-reconcile churn; a fire-time tool call is always fresh, costs one round trip, and pays tokens only on runs that react.

### D6: Observation is an instruction, not a pipeline

The engagement instruction gains an observe-and-distill clause: while reading channel messages during a run, if Claude notices a custom emoji used with a clear pattern that lore doesn't capture (or contradicts), it calls `describe_emoji` with `source: "observed"`, a paraphrased example, and the message permalink. No event listeners, no evidence store — the distillation happens inside the run that saw the evidence.

### D7: Lore hints on message-reading tools — deterministic and selective

`fetch_channel_messages` and `fetch_slack_message` scan their fetched messages for custom emoji usage (reaction names + `:name:` tokens in text, intersected with the `EmojiCache` so standard Unicode shortcodes are ignored) and check those names against the lore store. When one or more seen custom emojis have NO lore entry, the tool result carries a `lore_hint` string: the unknown names (≤5 + overflow count) + "if this conversation reveals what one of these means, capture it with `describe_emoji` (`source: "observed"`)". No hint when every seen emoji is known, no hint when none are custom.

Shared helper signature (in `src/emojiLore.ts`, consumed identically by both tools at result-assembly time):

```ts
buildLoreHint(names: Iterable<string>, emojiCache: EmojiCache): Promise<string | null>
// caller: const lore_hint = await buildLoreHint(collectEmojiNames(messages), emojiCache);
//         ... then spread `...(lore_hint ? { lore_hint } : {})` into the textResult payload
collectEmojiNames(messages: Array<{ text?: string; reactions?: Array<{ emoji: string }> }>): Set<string>
```

`lore_hint` is a top-level optional field on the payload (the `remember` tool's optional `warning` field is the precedent), not a mutation of message text — so it can't corrupt message content and is trivially assertable in tests.

Rationale: this turns every message-reading surface (DMs, mentions, auto-respond, idler, chatter) into a passive lore collector at the exact moment evidence is in front of Claude — without a standing instruction taxing every session. The known-emoji filter keeps it silent in the steady state, so hint frequency decays naturally as coverage grows.

*Alternatives rejected:* a baseline instruction file ("always consider emoji lore") — pays tokens on every session and fires with no evidence present; hinting on *every* custom emoji (including known ones) — steady-state noise with nothing to do. Deliberate scope cut: the hint does not try to detect *contradictory* usage of known emojis (that judgment stays with the engagement run's observe-and-distill clause); a mechanical diff of "usage vs stored meaning" isn't computable core-side.

## Risks / Trade-offs

- [Confidently-wrong observed lore steers reactions] → `source` field + taught-wins conflict rule + permalink receipts so any entry can be audited and corrected via `describe_emoji`.
- [Lore index grows past comfortable inline size] → compact form is ~15–25 tokens/entry; `lore_only: true` respects `limit` with a `truncated` flag; in practice workspaces have dozens of *loreful* emojis, not thousands.
- [Culture liability: lore that characterizes people] → examples are paraphrased, reactor identity never stored, tool description instructs Claude to describe *usage*, not *users*.
- [Lore hints derail Claude from the user's actual question] → hint is one line, phrased as optional ("if this conversation reveals…"), and only appears when unknown custom emojis are present; hint frequency self-decays as lore coverage grows.
- [Substring search still misses intent phrasing in direct `find_emoji` queries] → tags give multiple hooks per entry, and the casual-talk path sidesteps search entirely by reading the whole index.

## Migration Plan

Purely additive. Missing/empty `emoji-lore.json` → `find_emoji` behaves byte-for-byte as today and `lore_only: true` returns an empty set. No config flag, no migration. Rollback = delete the new code paths; the store file is inert data.

## Open Questions

- Should `describe_emoji` be role-gated (dev+) instead of open to all? Current call: open — worst case is bad lore, which is auditable and correctable.
