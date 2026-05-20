## Context

Trivia seasons (`trivia.seasons.enabled === true`) already have a well-developed *closing* moment — the last reveal fire of a season runs `applySeasonRollover`, stamps `endedAt`, optionally creates a continuation season, and the reveal prompt renders a wrap-up section + MVP callout + finale-treated leaderboard. The *opening* moment, by contrast, is silent: the first question post of the new season is indistinguishable from any other mid-season post.

`SeasonEntry` today carries `slug`, `startedAt`, `expectedEndAt`, `endedAt?`, `categories`, plus optional weights and an optional per-season `format`. There is no human-readable narrative label — admins building a themed season have to encode the theme in the slug (`season-2026-10-halloween`) or in the categories list, neither of which surfaces in any in-persona Slack message.

Two crons drive the plugin: a question-posting cron (Schedule A) and an answer-reveal cron (Schedule B). The closer/MVP/finale live on Schedule B's *last fire* of an old season. The natural place for an opener — at the *beginning* of the new season's life — is Schedule A's *first fire* of the new season. These two events live on different schedules and can never collide on the same message.

The trigger detection mechanism needs to be robust to bot downtime: if the bot misses the first eligible question-cron fire of a new season, the opener should fire on the next one — not get lost.

## Goals / Non-Goals

**Goals:**

- Give admins a place to record a human-readable season theme (e.g. "Halloween Spooktacular", "1990s Pop Culture").
- Announce the start of every new season at the top of its first question post — naming the slug, and mentioning the theme when one is set.
- Detect "first fire" stateless-ly so missed fires recover naturally.
- Keep existing behavior identical when seasons are disabled or when the active season has no theme.
- Keep the reveal flow untouched.

**Non-Goals:**

- Mentioning the theme on the closing reveal of the previous season (the closer announces what is *ending*, not what is *next*).
- Surfacing the theme on every subsequent question post during the season (one ceremonial intro at the start; the rest stay clean).
- A separate "opener-only" Slack message with no question — the opener is a header attached to the first real question post of the season.
- Mid-season theme edits propagating retroactively to the already-shipped opener (the opener fires once; later edits affect any future references only).
- Anything related to season *lifecycle administration* beyond exposing one new optional field — no new tools, no new admin UI flows, no theme-driven scheduling rules.

## Decisions

### Decision 1: Theme is a single optional string field

**Decision:** Add `theme?: string` to `SeasonEntry`. No structured sub-object, no `description` companion field, no internationalization scaffolding.

**Rationale:** The opener is one short narrative beat in a single Slack message. A bare string is enough — Claude can riff on it in-persona. Adding `{ name; description? }` would invite admins to write paragraphs that would either bloat the opener or get truncated. If a richer shape is ever needed, growing the field later is straightforward (string-or-object union with a one-line migration).

**Alternatives considered:**

- *Structured object* (`theme?: { name; description? }`) — rejected as over-engineered for the one consumer that exists today (the opener prompt).
- *Reuse `categories` as the theme* — rejected because the user's request explicitly distinguished "theme" from category list; a season can be themed without narrowing its categories.

### Decision 2: Detection is stateless — "zero saved questions with `season === currentSlug`"

**Decision:** `firstFireOfSeason` is computed inside `get_ideas` at call time as `loadQuestions(game).filter(q => q.season === currentSlug).length === 0`. No persisted flag. No cron-derived previous-fire computation.

**Rationale:**

- **Robust to missed fires.** If the bot is down through the first eligible fire, the next actually-run fire still sees zero saved questions for the slug and emits the opener naturally.
- **Naturally idempotent.** As soon as the first question is saved (via `save_question`) with `season === currentSlug`, every subsequent `get_ideas` call returns `firstFireOfSeason: false`. No write needed during the opener fire itself.
- **No schema additions beyond `theme`.** Avoids growing the persisted shape for transient state.
- **Cheap.** Question lists are bounded per game (questions accumulate slowly; an O(N) scan is trivial).

**Alternatives considered:**

- *Persisted `openerAnnouncedAt?: number` on `SeasonEntry`* — rejected because it requires a write back during the opener fire and another mutation path on rollover; the stateless rule subsumes its robustness benefits.
- *Cron-derived previous fire (`cron.prev(now)`)* — rejected because bot downtime swallows the opener; also fragile around schedule edits.
- *Sibling flag on `SeasonsState`* — rejected for the same downtime fragility.

**Caveats:** If a fire crashes after `save_question` succeeds but before the message ships (already a race we accept today), the *retry* will see one question already saved → `firstFireOfSeason: false` → opener gets lost. This is a minor cosmetic degradation, not a duplication bug, and matches the project's existing posture on partial-failure retries.

### Decision 3: Signal delivered via `get_ideas` output, not a new tool or extended `check_season_status`

**Decision:** Extend `get_ideas`'s output with `firstFireOfSeason: boolean` and (when set) `theme: string`. Do not add a new tool, do not extend `check_season_status`, do not require the question-posting prompt to make a second tool call.

**Rationale:**

- `get_ideas` already reads the active season and returns season-aware fields (`categories`, `suggestedAnswersFormat`, `suggestedQuestionType`, `contextPriority`). Adding two more derived fields is a natural extension.
- The question-posting prompt already calls `get_ideas` near the top of its flow; this keeps the opener detection on a path the prompt is guaranteed to traverse.
- `check_season_status` is scoped to the reveal flow (its description and `isLastFireOfSeason` semantics are reveal-cron-specific). Extending it would mix concerns.

**Alternatives considered:**

- *New `get_season_opener` tool* — rejected as a duplicative tool when `get_ideas` already returns season-derived data.
- *Extend `check_season_status`* — rejected because the field's semantics (zero saved questions for the slug) are question-post-context, not reveal-context.

### Decision 4: Opener is a `header` block + one `section` block at the very top of the first question post

**Decision:** When `firstFireOfSeason === true`, the question-posting prompt SHALL prepend a `header` block (e.g. `🆕 NEW SEASON: <name-or-slug>`) and one `section` block (in-persona prose mentioning the slug; mentioning the theme only when `theme` is present) above the question content. The rest of the message follows the normal layout for the question-cron fire.

**Rationale:**

- A `header` + `section` pair reads as a distinct event in the Slack thread, matching how the closer wrap-up reads on the other end.
- Reusing standard Block Kit primitives avoids a one-off layout; the opener is just two extra blocks that the prompt produces conditionally.
- Single message: no wasted question slot, no orphan "opener-only" post.

**Alternatives considered:**

- *Single section block, no header* — rejected as too quiet for what is, narratively, a season-defining moment.
- *Standalone opener message with no question* — rejected because it forfeits one day of trivia content for ceremony, and complicates the cron contract (the post returned would have no `questionId` to stamp).
- *Postpone the opener to the first reveal of the new season* — rejected because by that point a full day of questions has shipped silently; the opener arrives too late to feel like "the new season starts now."

### Decision 5: Theme on the opener is opt-in and silent when absent

**Decision:** The opener prompt branch SHALL mention the theme only when `theme` is present in the `get_ideas` output. When `theme` is undefined, the section block MUST NOT mention a theme at all (no placeholder, no "this season has no theme yet", no fallback to category lists).

**Rationale:** The user's explicit request — "mention the theme if there is one (if no theme, don't mention it)." A silent-when-absent rule keeps the opener honest and avoids degenerate phrasings.

### Decision 6: Continuation seasons leave theme undefined

**Decision:** When `applySeasonRollover` auto-creates a continuation `season-YYYY-MM` because no future season was queued, that continuation entry SHALL be created with `theme` undefined — even if the closing season had a `theme` set.

**Rationale:** Themes are narrative choices, not inheritable settings. Auto-continuing a "Halloween Spooktacular" theme into November would be wrong. Admins who want a continuing theme can pre-stage the next season via `upsert_season` with the desired `theme`.

## Risks / Trade-offs

- **[Risk]** Theme field could be abused as a long description that bloats the opener message. → **Mitigation:** Prompt explicitly treats `theme` as a short label to riff on, not a body to verbatim-include. Test asserts the opener doesn't blindly paste the theme string into a giant text block.
- **[Risk]** Stateless "zero saved questions" detection means a crashed-mid-post fire that saved a question but didn't ship the message will lose the opener on retry. → **Mitigation:** Documented in Decision 2 as an accepted cosmetic loss; matches the project's existing posture on retry semantics.
- **[Risk]** Admin sets `theme` mid-season expecting it to retroactively trigger an opener. → **Mitigation:** `firstFireOfSeason` is false the moment any question is saved for the slug; mid-season `theme` edits affect future references only. Documented in the upsert_season scenario.
- **[Risk]** A season window shorter than the question-cron cadence could conceivably produce a season with zero question fires — meaning the opener never ships. → **Mitigation:** Out of scope (pathological config); admins control season windows. No special handling.
- **[Trade-off]** Opener lives only on the question-cron path. The reveal-cron path on day-1-of-new-season has no equivalent "new season just started" hint. That reveal will simply show whatever the leaderboard naturally shows (likely sparse). Accepted for scope; the question post is the right place for ceremony, the reveal is the right place for verdicts.

## Migration Plan

- **Schema change:** Adding an optional field to `SeasonEntry`. Existing `seasons.json` files require no rewrite — the field is read as `undefined` when absent.
- **No data migration needed.** This change does not require a numbered migration in `src/migrations/`.
- **Rollout:** Ship behind the existing `trivia.seasons.enabled` gate — when seasons are disabled, neither `get_ideas` nor the question-posting prompt branches change observable behavior. When seasons are enabled but `theme` is unset on every season, the opener still fires (theme-less) on the first fire of each season — this is the intended new behavior.
- **Rollback:** Revert the code change. The `theme` field on any persisted `SeasonEntry` becomes inert (no consumer reads it). No data corruption risk.

## Open Questions

- Should there be a hard length cap on `theme` (e.g. 80 chars) to defend against giant strings reaching the opener? Leaving it unbounded for now; the prompt is the practical bound.
- Should the header block text use a fixed string (`"🆕 NEW SEASON"`) or be Claude-authored from the slug/theme? Leaning toward a fixed prefix + Claude appends a short flourish; the spec captures this as a prompt instruction, not a hard contract.
