## Context

The just-shipped `add-trivia-seasons` capability stores seasons as `{ current, currentStartedAt, currentExpectedEndAt, currentCategories, history[] }`. "Current" is a stored field, and the `start_new_season` tool is a destructive transition that simultaneously closes the active season and replaces it. This works for the linear case (May ends, June begins, life moves on) but breaks the moment an admin wants to **prepare a future season** in advance — to pick a themed name, set its date window, and curate its category pool before it goes live. There's nowhere to put the queued data: any call to `start_new_season` immediately ends the current season.

Earlier in this conversation we considered adding a single `next` slot to seasons.json — a draft for the upcoming season. That works but doesn't generalize: you can prepare one ahead, not two. The user pushed back: "we should be able to prepare multiple, no overlap." That instinct points at a structurally different model — a timeline of seasons rather than a `current/next/history` partition. Once you adopt the timeline, the distinctions between "current," "next," and "history" disappear; they're all just intervals at different positions on the time axis. "Current" becomes a derived view of the timeline at `now`, not a stored field.

This refactor adopts that shape. It's a breaking schema change, but the prior schema only existed for hours and has no production deployments; the GCP `seasons.json` was deleted in preparation. Replacing the entire `start_new_season` tool surface with a single `upsert_season` primitive is unusual but justified: the operations the old tool conflated (close-current + create-new + same-day-noop-guard) all become trivially expressible as upserts against the timeline, with a single no-overlap invariant providing correctness.

## Goals / Non-Goals

**Goals:**

- Allow multiple future seasons to coexist as prepared drafts, with no overlap between any two seasons' active windows.
- Allow admins to iteratively refine any future or current season's categories without forcing a rollover.
- Reduce the season-state mutator surface to a single primitive `upsert_season` (plus `delete_season` for retracting future drafts).
- Preserve the `season-finale + last-fire-of-season` reveal moment and the 3-row leaderboard.
- Preserve all existing tool signatures that consumers depend on (`retrieve_scores`, `submit_answers`, `find_previous_questions`, etc.).
- Stay backward-compatible for: the `trivia.seasons` config block; per-record `season` tagging on writes; the trivia-check instruction's admin guidance (rewritten but still present); the 3-row leaderboard rendering rule.

**Non-Goals:**

- **Slug renames.** Slug is treated as immutable internal key. Renaming = delete + recreate (only valid before `startedAt`).
- **Backward-compatible read of the old schema.** No migration; on-disk file was deleted in advance.
- **Date-triggered "auto-activation" with a poller.** Activation remains driven by the cron-scheduled reveal flow. The timeline determines what season is "current" given the current wall clock; nothing needs to actively flip a switch.
- **Gap detection / warnings.** Gaps are permitted by the no-overlap rule and are not warned about. They are quiet — writes during gaps simply get no `season` tag.
- **Querying / filtering future seasons through MCP read tools.** Slacks-facing visibility into "what's queued" is provided by extending `check_season_status`'s return shape; no new `list_seasons` query tool in this change (can be added later if needed).

## Decisions

### Decision 1: One flat `seasons` array instead of `current/history`

**Choice:** `seasons.json` becomes `{ seasons: SeasonEntry[] }` where each entry is `{ slug, startedAt, expectedEndAt, endedAt?, categories[] }`. No `current` field; no `history` field. Past, present, and future seasons are all entries in the same array, distinguished only by where their interval sits relative to `now`.

**Rationale:** "Current" being a stored field forced state-machine semantics on what is naturally an interval-overlay-on-a-timeline. The current/history split also forced `start_new_season` to do three things at once (close active, create new, validate same-day noop). With a unified timeline, the schema invariant becomes a single rule (no two seasons overlap), and the mutator becomes a single upsert that respects that rule. The "current" question becomes "find the season whose interval contains `now`" — a derived query, not a stored fact.

**Alternatives considered:**

- *Keep current/history, add a `next` slot.* Solves single-prepare; doesn't generalize. Rejected per user feedback.
- *Keep current/history, add a `drafts[]` array alongside.* Three buckets to reason about; the relationships between them (when does a draft become current?) reintroduce state-machine complexity. Rejected.

### Decision 2: `findCurrentSeason(state, now)` is the only "what's current" path

**Choice:** Add a pure function `findCurrentSeason(state, now): SeasonEntry | null` to the data layer. Every read site that previously did `state.current` now calls this helper. The rule: among seasons where `startedAt <= now`, the one with the latest `startedAt` is current — unless its `endedAt` is set and `endedAt <= now`, OR `expectedEndAt <= now` with no future season filling the slot, in which case the function returns `null`.

**Rationale:** Centralizing the "what is current" logic in one helper keeps the rule consistent everywhere it matters (tag-on-write, leaderboard ranking, MCP tool checks). Read sites become uniform. The helper is pure and easy to test (give it a fixed `now` and a fixed state; assert the output).

**Refined rule** for finding current:

```
function findCurrentSeason(state, now):
  active = state.seasons.filter(s => s.startedAt <= now && (s.endedAt ?? s.expectedEndAt) > now)
  if active.length === 0: return null
  if active.length === 1: return active[0]
  // active.length > 1 means overlap exists — should be impossible if upsert validates correctly
  throw new Error("invariant violated: multiple seasons active at " + now)
```

**Alternatives considered:**

- *Cache "current" at boot and refresh on tool calls.* Saves nothing — the timeline lookup is O(N) where N is bounded by total seasons ever (handful per year). Premature optimization, plus the cache adds a freshness invariant. Rejected.

### Decision 3: `upsert_season` is the single mutator; slug is immutable

**Choice:** A single tool `upsert_season(slug, { startedAt?, expectedEndAt?, endedAt?, themeExtras? })` handles all state mutations except deletion. If the slug exists, fields passed are updated; fields omitted are preserved. If the slug is new, the tool creates a new entry — requiring `startedAt` and `expectedEndAt`, and computing `categories = unique([...categories.json, ...themeExtras])` once at creation time. Slug is the row's identifier and is never modified; renaming a season requires `delete_season(oldSlug)` followed by `upsert_season(newSlug, ...)`, which is only viable while the old season has `startedAt > now`.

**Rationale:** The operations on a timeline reduce to "upsert this row" and "delete this row" plus a no-overlap invariant. Conflating "rename" into upsert would create an ambiguity (does `slug` arg identify the existing row or rename it?). Keeping slug as a stable key removes that ambiguity at near-zero cost — renames are uncommon and only meaningful pre-start anyway.

**Validation rules applied by `upsert_season`:**

1. `slug` is non-empty kebab-case.
2. On create: `startedAt` and `expectedEndAt` both present; `startedAt < expectedEndAt`.
3. On update of either timestamp: result still satisfies `startedAt < (endedAt ?? expectedEndAt)`.
4. No overlap with any other season's `[startedAt, endedAt ?? expectedEndAt)` interval. Self (same slug) is excluded from the overlap check.
5. Resulting `categories` array is non-empty.
6. Updates may not move `startedAt` of a season that has already started (`startedAt <= now`). The "shift the past" UX is not supported; admins who realize a date was wrong can edit `seasons.json` directly.

**Alternatives considered:**

- *Separate `prepare_next_season` / `end_season` / `extend_season` tools.* Three tools, three signatures, three test surfaces — for operations that are all "modify this row of the timeline." Rejected as needless duplication.
- *Allow slug rename via the upsert tool with a `newSlug` arg.* Adds a third semantics to the same call site (create / update-fields / rename). Confusing, low value. Rejected.

### Decision 4: `delete_season` exists, restricted to not-yet-started rows

**Choice:** A small `delete_season(slug)` tool removes an entry from the timeline. Refuses if the named season has already started (`startedAt <= now`) or is the only season on the timeline (the plugin always needs at least one season once seasons is enabled, otherwise reads of `findCurrentSeason` would always return null).

**Rationale:** Past and current seasons are immutable records — the leaderboard, the reveal history, and any future queries all depend on them existing. Future-only seasons are drafts and deletion is the natural retraction. The "at least one season exists" rule keeps the read path robust.

**Alternatives considered:**

- *No deletion at all; require update of dates to push it into the past.* Awkward — leaves a phantom past season nobody actually ran. Rejected.

### Decision 5: Last-fire reveal logic becomes timeline-aware

**Choice:** The reveal flow's step 13 (formerly "Start the next season") is rewritten:

```
13. CLOSE THE CURRENT SEASON AND ENSURE CONTINUITY (only when isLastFireOfSeason from step 6.5 is true)
    a. After submit_response, call upsert_season(currentSlug, { endedAt: now }) to stamp the actual end time.
    b. If check_season_status (step 6.5) reported nextSeasonSlug != null, do nothing else — the timeline takes over naturally.
    c. If nextSeasonSlug is null, call upsert_season(<derived slug>, { startedAt: now, expectedEndAt: <derived from prompt>, themeExtras: [...] })
       to create a continuation season. Without this, writes after the closing season are season-less.
```

`check_season_status` correspondingly extends its return shape with `nextSeasonSlug` (the slug of the season with the smallest `startedAt > currentExpectedEndAt`, or null) and `nextSeasonStartsAt`.

**Rationale:** The continuation-vs-takeover branch makes the auto-rollover behavior preserve user intent: if the admin has already prepared June, June goes live; if they haven't, Claude creates a continuation just like before. Either way the timeline never has a gap immediately after a reveal.

**Alternatives considered:**

- *Always call `upsert_season(<new>)` even if a future season is queued.* Would create a duplicate (with the queued season's window violating no-overlap). Rejected on correctness grounds.
- *Always create a continuation; admins must `delete_season` to cancel.* Could work but produces a noisy "continuation-then-immediately-overridden" pattern when an admin DOES want their pre-prepared season to take effect. The check-first pattern is friendlier.

### Decision 6: Category-tool target enum widens to "any slug"

**Choice:** `add_categories(categories, target)` and `remove_categories(categories, target)` `target` arg now accepts any of:

- `"current"` (default) — affects whichever season is currently active per `findCurrentSeason`.
- `"default"` — affects `categories.json` (the baseline that future-season creation uses).
- `"both"` — `"current"` AND `"default"` simultaneously (legacy alias preserved).
- `"<any-slug>"` — affects that specific season's `categories` array, whether past, current, or future.

The active-pool-empty guard on removal still applies, but now targets the read-active pool (per `findCurrentSeason`) rather than a special "currentCategories" field. Removing the last category from a future-only season is fine; removing the last category from the currently-active season is rejected.

**Rationale:** Once future seasons are first-class entries on the timeline, exposing them to category edits is just a question of letting the slug be the target. The same single tool handles every case.

**Alternatives considered:**

- *Separate tools for editing specific-slug categories.* Adds surface for no behavioral difference. Rejected.

### Decision 7: First-enable init writes a single timeline entry

**Choice:** On first-enable boot, the plugin writes `{ seasons: [{ slug: "season-YYYY-MM", startedAt: now, expectedEndAt: <end of current UTC month>, categories: [...categories.json] }] }`. No `endedAt` set. No history. The timeline starts with exactly one row.

**Rationale:** Preserves the existing first-boot UX (a season exists immediately, writes get tagged starting now). Trivially equivalent to the old shape's single-row state.

## Risks / Trade-offs

- **Risk:** Multiple admins simultaneously preparing future seasons could race on the no-overlap check. → **Mitigation:** all season mutations go through `upsert_season` which validates no-overlap at write time using a fresh `loadSeasonsState`. With the existing single-threaded write pattern (each tool call reads, modifies in-memory, writes the full file), races are bounded to the duration of a single tool execution. Worst case: two near-simultaneous calls both pass validation against the pre-write state and one's write wins; the loser's effects are silently lost. Acceptable given low admin contention and the pattern matches every other JSON-state tool in the plugin.

- **Risk:** "Current" becomes null during a gap, and writes during the gap stay untagged. Admins might not realize this can happen. → **Mitigation:** the documented invariant is that gaps are intentional (admin chose not to schedule continuity). `check_season_status` returning `currentSlug: null` is the clear signal. The trivia-check instruction and admin addendum will mention this.

- **Risk:** `delete_season` of a future season could leave the timeline with continuity gaps that aren't obvious until later. → **Mitigation:** documented behavior; admins can re-prepare. No automated continuity check — gaps are explicit.

- **Trade-off:** The schema change is breaking. → **Mitigation:** explicit no-migration policy (the prior schema is hours old, with no production deployment), VM `seasons.json` was deleted in advance, fresh init writes the new shape.

- **Trade-off:** Read-site changes (everywhere `state.current` was used → `findCurrentSeason(state, now)`) require touching every read path. → **Mitigation:** the change is mechanical; the new helper is a strict superset of what the old field provided.

- **Trade-off:** Tests get restructured. → **Mitigation:** the behavioral scenarios are nearly identical; the assertions just look slightly different. Estimated test rewrite cost is a few hours.

## Open Questions

- **Should `findCurrentSeason` throw or warn on detected overlap?** The invariant says it shouldn't happen, but the runtime check is cheap. Recommendation: throw — overlap implies a serious data corruption and silent fallback would mask it.
- **What's the right return shape for `check_season_status` when `currentSlug` is null (gap)?** Recommendation: return `{ currentSlug: null, isInGap: true, nextSeasonSlug, nextSeasonStartsAt }` so callers can branch. The reveal flow shouldn't fire during a gap (no question to reveal), but the field is informational.
