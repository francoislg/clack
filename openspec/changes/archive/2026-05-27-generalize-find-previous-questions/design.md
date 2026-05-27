## Context

`find_previous_questions` is the only tool Claude has for duplicate detection during question generation, and also the canonical admin lookup tool (e.g. "show me the last batch's difficulty"). Today its schema is purpose-built for the dedup case but in a brittle way: a single `text` keyword, a required `game` arg, and conjunctive composition across `category`/`text`/`season`. That shape was correct for the original "one keyword, one game" mental model but doesn't fit either:

- **Dedup recall**: Claude routinely fails to surface synonyms or reformulations because it must pre-commit to a single keyword pick. The same fact in a sibling game silently slips through because game-scoping is hard-coded.
- **Admin flexibility**: Admins occasionally want to span multiple categories or seasons in one call, or do a union-style "any of these criteria" search. The current AND-only top-level forces multiple calls.

Constraints:

- `find_previous_questions` MUST continue to exclude answer-key fields (`isTrue`, `correctIndex`) from its response. That safety requirement (today's `Find previous questions response excludes the answer key`) is non-negotiable and is preserved verbatim.
- `recentBatchFromNow` already groups by `batchId`. `batchId`s are minted per `post_questions` call and are not globally unique across games. Any redesign must keep this feature working and prevent incoherent cross-game batch rankings.
- Tool is gated to `member` role. No role change.
- This is a Claude-facing MCP tool. Old callers are Claude and the prompts. There is no external API consumer to migrate — the breaking-change blast radius is internal.

## Goals / Non-Goals

**Goals:**

- Let Claude pass multiple keywords in one dedup call, so the matched-vs-missed signal isn't bottlenecked on a single guess.
- Let Claude (and admins) search across all games by default, not just one.
- Provide a clean, uniform `match: "any" | "all"` lever across all top-level array criteria.
- Make matches explainable: each returned row carries the subset of input keywords that hit, so Claude can reason about *why* a row surfaced.
- Preserve the answer-key exclusion behavior and the `recentBatchFromNow` semantics for the single-game case.

**Non-Goals:**

- Embedding-based or LLM-based semantic matching. Keyword substring matching is sufficient for v1; smarter recall is a follow-up if substring proves insufficient.
- Server-side dedup gating (e.g. forcing `save_question` to require a `dedup_decision[]` arg). The validation gate remains in the prompt; if the prompt proves insufficient, we revisit.
- Per-keyword scoring (TF-IDF, BM25, etc.). All keywords contribute equally; ranking remains by `createdAt` desc.
- Per-row `sameContext` flag. Rows already carry `context`; the prompt tells Claude to compare it against the draft's context. Adding a server-computed flag would require accepting the draft's context as input — extra surface for negligible benefit.
- Backwards-compatibility aliases (`game` → `games`, `text` → `keywords`, etc.). Breaking the schema cleanly is preferable to carrying two shapes.

## Decisions

### Decision 1: `match` is top-level only; arrays are always internal-OR

`match: "any" | "all"` combines top-level criteria. Within any single array criterion (`games[]`, `categories[]`, `seasons[]`, `keywords[]`), the combinator is always OR.

**Why**: Two readings were possible — (A) `match` only at the top, arrays always OR; or (B) `match` applies everywhere including within arrays. We chose (A) because:

- It mirrors how SQL filters compose: `WHERE col IN (...)` is OR-internal; the `WHERE`-clause combinator is what AND/OR controls.
- For dedup, OR-internal keywords are the correct semantics (any keyword overlap is a candidate worth inspecting). Forcing AND-internal keywords would degrade recall — Claude would have to know in advance which keywords overlap a duplicate.
- It keeps the mental model symmetric across all four array criteria.

**Alternative considered**: (B) — `match` applies within arrays too. Rejected because it created two distinct behaviors per criterion, doubling the surface Claude has to reason about, with no clear win for the dedup case.

### Decision 2: Default `match: "all"`

If `match` is omitted, criteria are AND'd together — matching today's filter semantics for `category` + `season` + `text`.

**Why**: This preserves admin muscle memory (e.g. "find Music questions from season-X" reads as "both must hold"). The recall-favored `match: "any"` is opt-in for dedup, and the prompt explicitly requests it at each callsite.

### Decision 3: `games` becomes optional; omission = cross-game scan

When `games` is omitted or empty, every game's `questions.json` is read. When provided, only the named games are read. Per-row response carries `game: string` so Claude can see provenance.

**Why**: Cross-game dedup is the user's explicit ask. Game-scoped dedup misses the case where the same fact is asked in a sibling game. Cross-game becomes the default for dedup callsites in the prompt; admins can still narrow with `games: ["X"]`.

**Validation impact**: When `games` is provided, every entry is validated against `config.trivia.games[]`. Unknown name → "unknown game" error citing the offending entry. Disabled games are still readable (frozen-archive semantics — same as today). When `games` is omitted, no per-name validation runs; the tool walks every game in `config.trivia.games[]` (skipping any with no `questions.json` file).

### Decision 4: `recentBatchFromNow` requires exactly one game

When `recentBatchFromNow` is present, the tool requires `games.length === 1`. Other shapes (omitted, multi-game) produce a validation error.

**Why**: `batchId`s are minted per `post_questions` call within a game and are not unique across games. Ranking batches across games by `max(postedAt)` would mix Game A's and Game B's batches in arbitrary interleavings — semantically meaningless. Restricting `recentBatchFromNow` to single-game keeps its definition coherent. Admins doing batch lookups already know which game they care about.

### Decision 5: `matchedKeywords` is computed, not stored

When `keywords` is non-empty, every returned row carries `matchedKeywords: string[]` — the subset of input keywords whose lowercased form is a substring of the row's lowercased `statement`. When `keywords` is empty/omitted, the field is absent.

**Why**: Claude needs to see *which* keywords hit each row, both to judge dupe vs not and to refine the next call if recall was too wide/narrow. Computing it server-side is free (we're doing the substring scan anyway) and prevents Claude from having to re-derive it.

### Decision 6: `seasons` array drops the `"all"` sentinel; preserves `"current"`

`seasons` as an array makes `"all"` semantically redundant — omitting the array means "no season filter." Special entry values reduce to one: `"current"`, which still resolves via `findCurrentSeason` against the named game's `seasons.json`.

**Why**: One way to do each thing. `seasons: ["all"]` is awkward English and conflicts with the fact that `"all"` is not a real season slug.

**Edge case**: When `games` is multi-game and `seasons: ["current"]` is passed, `"current"` resolves *per game* (each game's seasons timeline is independent). A row from Game A passes the seasons filter if its `season` matches Game A's current; a row from Game B passes if its `season` matches Game B's current.

### Decision 7: Empty arrays equal omitted arrays

`games: []`, `categories: []`, `seasons: []`, `keywords: []` all behave as if the criterion were omitted (the criterion is not supplied; ignored in the combinator).

**Why**: Eliminates an entire class of "what does empty mean" bugs. Symmetric with how the criterion-not-supplied case already works for omitted optionals.

### Decision 8: Per-row response gains `game`; everything else preserved

Today's per-row response (`id`, `category`, `statement`, `emojis`, `createdAt`, plus per-format extras minus the answer key) gains exactly two fields:

- `game: string` — required on every row, regardless of whether the call was cross-game or single-game.
- `matchedKeywords?: string[]` — present iff `keywords` was non-empty.

All existing fields, including the answer-key exclusion, are preserved.

## Risks / Trade-offs

- **[Risk] Cognitive load on Claude.** Today Claude makes one call with one keyword. Tomorrow Claude picks 3–5 keywords and a match mode in one call. If Claude routinely picks bad keyword sets, dedup recall stays poor. → Mitigation: the prompt explicitly tells Claude to use distinctive terms (names, numbers, rare nouns) and to pass `match: "any"` for dedup. The new `matchedKeywords` field gives Claude a feedback signal — if all returned rows hit only stopwords, Claude can re-call with sharper keywords.
- **[Risk] Cross-game scans get slow.** `loadQuestions()` reads every game's `questions.json` from disk. With many games and large files, this could become noticeable. → Mitigation: in practice, total trivia question volume per workspace is small (low thousands). If this becomes a hot path, the data layer can cache reads. Not worth optimizing pre-emptively.
- **[Risk] Recall too wide degrades Claude's judgment.** A 5-keyword `match: "any"` cross-game query could return 20+ candidates of which most are loose matches. Claude has to read each. If Claude rubber-stamps the list, dedup fails open. → Mitigation: `matchedKeywords` per row makes it cheap for Claude to spot loose matches (e.g. a row that only matched on "the" can be dismissed). The default `limit: 20` caps the response. The prompt instructs Claude to call again with sharper keywords if the result is noisy.
- **[Trade-off] No semantic matching.** Wolfgang ↔ Mozart, WWII ↔ Second World War — substring matching misses these. An embedding-based recall layer would catch them but adds storage, indexing, and inference cost. Substring is cheap, deterministic, and explainable; if the prompt + multiple-keyword call doesn't close enough of the gap, we revisit with embeddings as a v2.
- **[Trade-off] Breaking the schema cleanly vs aliasing.** Keeping old names as aliases would soften the migration but doubles the schema surface forever. Since the only callers are Claude (via prompts under our control) and admins (who read the tool description at call time), breaking cleanly is the right call.

## Migration Plan

This is a Claude-facing tool change, not a data migration. Deployment steps:

1. Land the schema + filter rewrite + test rewrites in one PR.
2. Update the six prompt callsites and line 460 in the same PR — the prompts and the schema must move together because the old prompt asks Claude to pass `text:`, which the new schema rejects.
3. Verify the spec/test alignment locally before merge.
4. On deploy, in-flight sessions continue with the old prompt baked into their context — the next tool call from those sessions will fail Zod validation and Claude will self-correct (the error message will name the offending field). Brief noise, then steady state. Acceptable because trivia sessions are short-lived.

No data migration: `questions.json` rows are unchanged. No config migration: `config.trivia.games[]` is the same.

Rollback: revert the PR. Old prompts + old schema continue to work; no data has been written that depends on the new shape.

## Open Questions

None. The shape is locked.
