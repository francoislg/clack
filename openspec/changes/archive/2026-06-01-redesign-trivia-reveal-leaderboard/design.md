## Context

The reveal leaderboard is rendered by Claude from the `process_reveal_answers` payload, following a contract written into `PROCESS_REVEAL_INSTRUCTIONS` (`scheduledPrompts.ts`). The payload already carries everything needed: `roundSummary.perPlayer` (per-player this-round counts, pre-sorted by `correct` desc), `leaderboard[]` (with `currentSeasonCorrect` / `totalCorrect`), and `seasonStatus` (`hasPriorSeasons`, `isLastFireOfSeason`, `mvp`). The table contract is currently split across two specs — `trivia-seasons` owns the Current Season / All Time rows, `trivia-scheduled-prompts` owns the This Round augmentation — and they have drifted (top-3 vs top-4 medals; live code does top-4).

This change is overwhelmingly **prompt-contract work** plus one **config axis**. No new data, no algorithm in code beyond resolving a 3-value enum.

## Goals / Non-Goals

**Goals:**
- Lead the reveal with This Round; sort the table by it; keep columns aligned as units.
- One medal rule (dense rank by distinct value) used by every medaled row and the finale podium/table.
- A purpose-built season-finale layout (podium + participation tail + gated All-Time table).
- A `allTimeRow` config axis controlling the All-Time surface everywhere, defaulting to `end-of-season-only`.
- "Nobody got it" → expanded answer detail when no one was correct.

**Non-Goals:**
- No change to seasons-disabled reveals beyond what already exists (legacy shapes; `allTimeRow` is a no-op there).
- No new scoring concept — "pts" is the existing `currentSeasonCorrect` count.
- No season/slot tier for `allTimeRow` (game + workspace only; trivial to extend later).
- No data migration; no i18n (all strings are VIA-Claude).

## Decisions

### D1 — Additive row model replaces the four fixed table shapes
Today the seasons-enabled table is a tangle of "legacy 3-row / 4-row / 2-row / 3-row labeled" shapes gated on `reveals.length`, `roundSummary`, and `hasPriorSeasons`. Replace with one additive rule for normal (non-finale) reveals:

```
seasonStatus PRESENT:
  rows = [ This Round?, Current Season, All Time? ]
    This Round  → when roundSummary present
    Current Season → ALWAYS (the anchor/label row)
    All Time    → when hasPriorSeasons AND showAllTimeRow
seasonStatus ABSENT (seasons off): legacy shapes unchanged
```

This auto-delivers the single-season relabel: when `hasPriorSeasons === false`, the table is `This Round? / Current Season` (labeled) — the old unlabeled 2-row disappears. *Why:* one rule is far less error-prone for Claude to follow than four shape variants, and the relabel falls out for free.

### D2 — Column order decided once, by This Round
The Slack `table` block requires uniform column widths, so a player owns exactly one column across all rows. Make this explicit as a two-step in the prompt: (1) compute the ordered player list — by `roundSummary.perPlayer` order when present (already `correct`-desc), then remaining season participants appended by `currentSeasonCorrect` desc, em-dash/absent last; without `roundSummary`, by `currentSeasonCorrect` desc — then (2) every row fills cells in that exact order. *Why over "sort each row":* sorting a single row independently would desync columns and produce a nonsensical table. The leftmost-column semantics shift from "season leader" to "round leader" — an intended, visible consequence.

### D3 — One medal rule: dense rank over distinct values
`assign medals by distinct value, descending: 1st distinct → 🥇, 2nd → 🥈, 3rd → 🥉, 4th → 🎀; all cells holding a value share its medal; 0 / em-dash / absent never medaled; per row independently.` Applied to: This Round, Current Season, All Time rows; the finale All-Time table; and the finale podium (top-3 distinct values as places, 4th distinct value wears 🎀 inline in the participation tail). *Why dense (1,2,3) over competition (1,2,2,4):* matches the user's "two people at 1 both get gold." *Why keep 🎀:* it's in the live code; reconciling the spec drift to top-4 preserves current behavior.

### D4 — `allTimeRow` is a render-gate flag computed in the tool
Mirror the `hint` axis: `TriviaAllTimeRowMode = "always" | "never" | "end-of-season-only"`, cascade `game → workspace → "end-of-season-only"`, resolved by a pure `resolveAllTimeRow(game, workspace)` in `domain/allTimeRow.ts`. The tool computes a single boolean `showAllTimeRow = shouldShowAllTimeRow(mode, seasonStatus.isLastFireOfSeason)` and adds it to `ProcessRevealResult`, so the prompt branches on one clear flag rather than re-deriving the rule. *Why a resolved boolean over passing the raw mode:* keeps the rollover-timing logic (`isLastFireOfSeason`) in code, not in Claude's head; back-compat is `showAllTimeRow` absent → treat as shown. *Why default `end-of-season-only`:* the user wants All Time to be a finale treat, riding in with the season wrap-up rather than cluttering daily reveals.

The All-Time surface gate is `hasPriorSeasons && showAllTimeRow` everywhere — so it's skipped at the first season's end (redundant with Current Season / the podium) and whenever the flag says hide.

### D5 — Finale is a distinct layout, not a section bolted onto the table
On `isLastFireOfSeason`, replace the old "finale section above the table" with:
```
per-question verdict blocks
── "And now, the season's winners!" ──
  🥇/🥈/🥉 First/Second/Third place lines  (top-3 distinct currentSeasonCorrect, ties share a place)
  Participation prizes: 🎀 <4th> (n pts), <rest> (n pts), …   (one line, everyone below the podium)
── "And the all-time leaderboard:" ──     (only if hasPriorSeasons AND showAllTimeRow)
  medaled All-Time table, columns by totalCorrect desc
── closer ──
```
The current-season standings move from a table row into the podium; the finale's only table is All-Time. Zero-participation players are omitted (same rule as the table). *Why:* the finale is a once-per-season moment that warrants a real ceremony, not a one-line MVP callout.

### D6 — "Nobody got it" → expanded detail when `correct` is empty
When a question's `correct` bucket is empty, the per-question verdict swaps misser-naming for an expanded explanation of the correct answer. In `"yes"`/`"just-correctness"` modes (named buckets) it replaces the INCORRECT name section; in `"just-winners"` (counts only) it pairs with the existing "everyone got fooled" anonymous line. *Why:* with no winner to celebrate, the educational payoff (teaching the room the answer) is the natural content. Distinct from "nobody answered at all" (all `noAnswer`) — though both share an empty `correct`, so the requirement is stated on the empty-`correct` condition and the expanded detail is appropriate to either.

## Risks / Trade-offs

- **[Default flip changes observable behavior]** → existing seasons games lose the daily All Time row. Intended per the proposal; called out as BREAKING (default). Admins wanting the old behavior set `allTimeRow: "always"`.
- **[Leftmost column no longer = season leader]** → could momentarily confuse regulars. Mitigated by the explicit `This Round` label on the top row and medals still marking true per-row rank.
- **[Claude mis-follows dense-rank ties or row-independent sorting]** → mitigated by a single shared medal definition + worked examples showing a tie and a desynced-looking-but-correct column (all-time leader parked mid-table), plus prompt assertions in tests.
- **[Finale layout omitted when `roundSummary` absent]** → finale podium reads from `leaderboard` (current-season), not `roundSummary`, so it renders regardless of reveal mode; only the per-question verdict richness varies. No gap.
- **[Participation tail unbounded in large rooms]** → one comma-separated line could grow long. Acceptable for trivia room sizes; a cap (e.g., next ~10) can be added later if needed (noted, not implemented).

## Migration Plan

- Additive, optional config field — no data migration. Deploy is a prompt + config-schema update.
- Rollback: revert the change; `allTimeRow` values written by admins become inert (ignored) under the old code.
