## Context

The trivia plugin's question lifecycle today is two phases: `questionCron` fires → Claude generates and posts in one run → `revealCron` fires → Claude reveals. Generation latency is variable (3–60+ seconds depending on flow path and slot count) and any failure during the run risks either dropping the post or producing a partially-posted batch. There is no admin affordance for pre-staging content.

Pre-staging means decoupling generation timing from post timing. The natural seam is between `save_question` (which already writes to disk without posting) and `post_questions` (which delivers to Slack). A "staged" question is one with `postedAt === undefined` — this state already exists in the data model but is never observed at the millisecond level today because gen and post are coupled in the same Claude run.

This change introduces a third optional cron schedule (`prepCron`) that fires the gen flow without the post flow, leaving the staged records on disk for the question cron to pick up. The question cron's prompt gains a "check what's staged first" prefix and a fallback that inline-generates anything missing — so the system degrades gracefully when prep fails, when prep hasn't been configured yet, or on the very first fire after a fresh install.

## Goals / Non-Goals

**Goals:**

- Allow admins to opt in to pre-staging on a per-game basis without forcing it on existing games.
- Make the prep run structurally incapable of posting — both via channelless cron declaration and via tool allowlist restriction.
- Reuse the existing question-data shape (`TriviaQuestion`) without introducing a separate "staged question" type or a batch-container abstraction.
- Make the staged-pool query reachable via an existing tool (`find_previous_questions`) rather than a new endpoint — minimize tool surface area.
- Unify the question-cron prompt across opt-in and opt-out games. The same `POST_QUESTIONS_INSTRUCTIONS` runs whether prep ran or not; the staged-pool query naturally returns nothing when prep wasn't configured, so the inline-gen fallback covers both cases.
- Ground format coherence in the per-question `slot.index` tag (already stamped by `save_question`) rather than in a separate batch-level snapshot.
- Survive mid-window format edits gracefully — staged questions hold their slot identity from save time; new slots added between prep and post fall through to inline-gen at post time.

**Non-Goals:**

- No bot-side cron arithmetic. The bot never derives `prepCron` from `questionCron`. Claude does that at game-setup time inside `upsert_game`.
- No batch-container abstraction. The "staged batch" is just the set of staged questions across slot indices, queried at post time. No batch ID is minted at save time; the existing post-time `batchId` minting in `post_questions` is unchanged.
- No workspace-default `prepLeadMinutes` config. Each game authors its own cron expressions.
- No new tool. Staged-pool querying is a filter extension on `find_previous_questions`.
- No data model changes beyond the schema-level `prepCron` field on `TriviaGame`.
- No migration. Existing games without `prepCron` keep working unchanged.
- No SDK changes. The prep cron uses the existing channelless-cron capability.
- No special handling of topical-question staleness. Topical generation already defaults to zero weight; admins who enable topical accept the 30-min-or-so freshness window.
- No "pre-fire hook" or cron-derivation primitive in the SDK. The prep cron is a fully independent spec, not a hook off the question cron.
- No partial-batch post mode. When prep is incomplete at post time, the inline-gen fallback fills the gap; the post always ships a full batch.

## Decisions

### 1. `prepCron` is optional on `TriviaGame`, no migration

Adding `prepCron` as required would force a migration over every existing game's config — and there is no single "correct" prep cron derivation that handles every cron expression (midnight crossings, week-of-month patterns, multi-fire-per-day schedules). Making it optional sidesteps the migration entirely:

```ts
interface TriviaGame {
  // ...existing fields
  prepCron?: string;
}
```

When admins want pre-staging, they author the cron explicitly. Claude assists at setup via `upsert_game`'s admin instructions — when an admin doesn't supply `prepCron`, Claude proposes a sensible value (typically 30 min before `questionCron`) based on the user's intent. Edge cases like midnight crossings are handled by Claude's reasoning, not by deterministic bot code.

**Why not derive from `questionCron` at reconcile time:** cron expressions are repeating patterns, not arithmetic on patterns. Shifting `0 0 * * *` (midnight daily) back 30 minutes requires either crossing into the previous calendar day (which the original day-pattern may exclude) or fabricating a different cron expression. The set of "shifts that work cleanly" is large enough that admins hit the edge cases regularly, and each edge case has a different "right" answer. Putting this logic in Claude's reasoning (with timezone awareness, semantic understanding of the schedule's intent, and the ability to suggest alternatives) is dramatically more robust than encoding it in bot code.

### 2. Two-layer structural enforcement of "prep cannot post"

The prep cron has two independent layers preventing it from delivering a Slack message:

1. **Channelless cron declaration** — `CronJobSpec.channel` is omitted on the prep spec. The SDK already restricts `submit_response` to `{ skip_response: true }` on channelless runs (see `src/plugins/CLAUDE.md`). So Claude cannot end the prep run with a Slack-bound `submit_response`.
2. **Tool allowlist** — the prep spec's `requiredTools` excludes `post_questions`. Claude in the prep run literally does not have the tool available, so it cannot call it even if the prompt instructed it to.

Both layers exist because the failure mode of accidentally posting from a prep run (e.g., a prompt error nudges Claude to call `post_questions`) is highly visible to end-users and easy to miss in code review. Defense in depth costs nothing here — both restrictions use pre-existing SDK and tool-config mechanisms.

The post cron remains channel-attached and keeps `post_questions` in its tool list.

### 3. `find_previous_questions` extended with `posted?: boolean`

The staged-pool query is a natural extension of the existing search tool — same predicate combinator semantics, same row shape returned. Adding `posted?: boolean` as a new criterion:

- `posted: true` → `q.postedAt !== undefined`
- `posted: false` → `q.postedAt === undefined`
- omitted → criterion ignored (today's behavior)

It participates in the `match: "all" | "any"` combinator like any other criterion. Typical usage:

```
PREP / POST prep-step:
  find_previous_questions({
    games: ["foo"],
    seasons: ["current"],
    posted: false,
    match: "all"
  })
  → all staged for game foo in the current season
```

**Why not a new dedicated `list_staged` tool:** the tool surface area for the trivia plugin is already large; adding one more endpoint that returns rows in the same shape as `find_previous_questions` would be redundant. The name mismatch ("previous" implies "past") is a minor cosmetic concern that doesn't justify the duplication. The tool's description gains a paragraph clarifying it's now the staged-pool query too.

### 4. `recentBatchFromNow` and `posted: false` are mutually exclusive

`recentBatchFromNow` already filters to `postedAt !== undefined && batchId !== undefined` internally. Combining it with `posted: false` would always return an empty set. The tool SHALL reject this combination at validation time with a clear error message — "`recentBatchFromNow` requires posted questions; pass `posted: true` or omit it together with `posted: false`."

### 5. Prompt routing splits on `prepCron` presence

The question cron uses one of two different prompts based on whether the game opts in to prep:

- **`prepCron` set** → `<game>:question` uses `POST_QUESTIONS_INSTRUCTIONS` — the new prompt that starts with a staged-pool check and falls back to inline-gen for any missing slot.
- **`prepCron` absent** → `<game>:question` uses `SEND_QUESTIONS_INSTRUCTIONS` — the legacy prompt, observable behavior unchanged from before this proposal.

`POST_QUESTIONS_INSTRUCTIONS` is structured as:

```
1. find_previous_questions({ games, seasons: ["current"], posted: false }) → staged pool
2. read format via get_ideas (slot 0 call; format meta on the response)
3. for each slot index in [0..slotCount-1]:
     if staged pool has a question for this slot: pick the oldest
     else: run the per-slot generation flow inline (existing FACT/CHOICE/etc. paths)
4. assemble the message: opener (if first-fire-of-season), per-question blocks built
   from question data + flair, closer
5. post_questions({ items: [...] })
6. submit_response({ skip_response: true })
```

When prep ran successfully, step 3's else-branch is a no-op. When prep failed but prep was configured, step 3's else-branch covers the missing slots inline.

**Why route by `prepCron` instead of unifying:** games without prep would pay a wasted `find_previous_questions({ posted: false })` call per fire — the pool will always be empty, so the call is pure overhead. More importantly, the prompt text mentions "STAGED POOL CHECK" and "FILLED vs MISSING" semantics that are meaningless when prep was never set up — including those concepts in every prompt would make the legacy flow harder to reason about. Splitting prompts costs zero behavioral divergence (the shared `PER_SLOT_GENERATION_PATHS` and `FORMAT_AND_POST_SECTION` ensure the actual generation/posting logic stays identical) and avoids both costs.

Internally, all three prompts (`SEND_`, `PREP_`, `POST_`) compose from the same building blocks, so when one of them needs a content change (e.g., a new path added to the matrix, or a tweak to the format/post section), the change propagates to all three automatically.

### 6. PREP is a strict subset of POST

```
PREP_QUESTIONS_INSTRUCTIONS = POST_QUESTIONS_INSTRUCTIONS
  minus the post step (step 5)
  minus the message assembly (step 4)
  minus the "pick the oldest" branch in step 3 (PREP only fills, doesn't pick)
```

Implementation: extract the per-slot generation flows (the FACT/CHOICE/TOPICAL/FREEFORM matrix) into a shared block; PREP's prompt and POST's prompt both include it. PREP terminates after the last `save_question` with `submit_response({ skip_response: true })`; POST continues into assembly + `post_questions`.

### 7. Format snapshot is implicit in `slot.index` + `slot.label`

`save_question` already stamps `slot: { index, label }` on every record when the active format is non-null. The label snapshot is denormalized — it's the slot's label at write time, frozen against later format edits. This existing behavior is the format snapshot.

Format coherence at post time:

- POST resolves `effectiveFormat` fresh at fire time.
- For each slot index in `[0..slotCount-1]`, POST looks for a staged question with that index.
- If found → use it (its slot label may differ from the current label; that's fine, the question's contents are what matter to the audience).
- If not found → inline-generate per the slot's current effective rules.

This handles mid-window format edits gracefully:

- **Slot added between prep and post** → no staged question for the new slot index → inline-generate it at post time.
- **Slot removed between prep and post** → staged question for the removed index is orphaned in the pool, stays on disk, not picked.
- **Per-slot rules changed between prep and post (e.g., answersFormat weights flipped)** → the staged question's content reflects the rules at save time, not post time. The question still posts. This is consistent with `liveAnswersVisible`, `revealResponses`, and `season` already being stamped at save/post time elsewhere.

### 8. Season scoping at post time

POST's staged-pool query passes `seasons: ["current"]` so only questions whose `season` matches the current season slug are picked. This drops orphans from a season rollover that occurred between prep and post.

When seasons are disabled, the `seasons` filter is silently ignored (existing behavior of `find_previous_questions`), so all staged questions are eligible regardless of `season` value.

### 9. Off-days propagate uniformly

`OffDay` entries already produce `skipDates` propagated to question + reveal specs today. The prep spec receives the same `skipDates`. This means on an off-day, all three crons skip — no wasted prep generation for a question fire that's also skipped.

Note: the `skipDates` semantics are relative to each cron's own fire date. If prep fires at 8:30 AM and question fires at 9:00 AM the same calendar day, both share the off-day. If prep is configured to fire the previous evening (less common, see decision 11), they no longer share the off-day cleanly — admins authoring such schedules need to author their off-days carefully. This is consistent with the existing semantics for question + reveal cron pairs that span midnight.

### 10. Inline-gen fallback covers bootstrap and failure modes

The question cron always runs the same prompt. On the very first fire after enabling prep on a game — before any prep run has completed — the pool is empty and the inline-gen branch covers every slot. Same when prep fails for any reason (Claude crash, network error, timeout). The system is self-healing: a missed prep run inflates the next question cron's latency but never silences the channel.

This makes the prep schedule an **optimization**, not a hard prerequisite. Admins can opt in incrementally; experimentation is low-risk.

### 11. Recommended convention: prep fires 30 min before question cron

The "right" prep timing has trade-offs:

- **Too close to question cron** (e.g., 5 min) — generation may not finish in time. Inline-gen fallback kicks in, defeating the purpose.
- **Too far from question cron** (e.g., 24 hours) — topical questions go stale; questions written "yesterday" may reference events that aged poorly.
- **Recommended sweet spot: 30 min** — covers worst-case generation latency for a 3-slot batch with self-review reframes, while keeping topical questions fresh.

The `upsert_game` tool's admin instruction guidance proposes 30 min as the default and explains the trade-offs so admins can adjust. The bot enforces nothing — admins are free to schedule prep at any cron time they want.

## Risks / Trade-offs

- **Topical staleness for long prep windows.** A topical question generated at prep time references "this week's news" with a freshness anchored at save time. If admin configures a 6-hour prep window, the headline-grade topicality degrades. **Mitigation:** the management instruction warns about this; topical defaults to zero weight so most users never hit it. Defer a TTL-based skip mechanism to a future change if usage data shows it bites.
- **Prep run failures silently fall back to inline-gen.** The post run never knows whether prep succeeded — it just sees the pool's state. A persistent prep failure (e.g., prep cron expression invalid, prep Claude run consistently crashing) would degrade silently into "post is slow but works." **Mitigation:** existing scheduled-run telemetry (`CronJob.runs[]` records success/failure per fire) surfaces this in the Home Tab. Admins reviewing the schedule list see consecutive failures. No automatic admin DM in v1.
- **Cron-arithmetic responsibility moves to Claude.** Without bot-side derivation, the correctness of "30 min before X" depends on Claude's reasoning at game-setup time. Claude can get this wrong — e.g., shifting a `0 0 * * *` cron back to `30 23 * * *` without realizing the day pattern excludes the previous day. **Mitigation:** the management instruction documents the common cases and warnings explicitly; Claude is shown examples. Admins can override Claude's suggestion at any time.
- **Mid-window format edits create orphaned staged questions.** When an admin removes a slot from the season's format between prep and post, the staged question for that slot stays on disk, untouched. **Mitigation:** no automatic cleanup in v1; orphaned records are inert (never picked by POST). A future admin-tier "garbage collect staged" tool could prune them if accumulation becomes an issue.
- **Concurrent prep + admin manual gen could double-fill a slot.** Admin DMs Claude to pre-generate slot 1 → before prep cron fires, admin's manual save lands → prep cron also fires → both PREP runs see "slot 1 unfilled" briefly. **Mitigation:** prep runs are scheduled sparsely (typically once per day per game); concurrent admin-manual prep within the same minute is exotic. Both runs would save independently; POST picks the oldest, the newer is orphaned until format-aligned cleanup or a future fire. Acceptable corner.
- **`find_previous_questions` description grows another paragraph.** Adding `posted` makes the tool wear three semi-distinct hats (duplicate detection, recent-batch lookup, staged-pool query). Risk of Claude getting confused about which mode applies. **Mitigation:** the description's existing structure (paragraph per mode) extends cleanly; tests cover the staged-pool query path explicitly.

## Migration Plan

No data migration required. Deployment is a single rolling update:

1. Ship the `TriviaGame.prepCron` type, the parser validation, and the `buildGameSpecs` branch that emits the 3-spec set when `prepCron` is present. Existing games (no `prepCron`) emit 2 specs as today.
2. Ship `find_previous_questions`' new `posted?: boolean` filter. The tool's existing call sites are unaffected (omitted = today's behavior).
3. Ship the split prompts (`POST_QUESTIONS_INSTRUCTIONS`, `PREP_QUESTIONS_INSTRUCTIONS`). The new `POST_QUESTIONS_INSTRUCTIONS` is a strict superset of the old `SEND_QUESTIONS_INSTRUCTIONS` — when `posted: false` returns an empty pool, the prompt's behavior collapses to today's gen-and-post flow.
4. Ship the `upsert_game` extension + admin instruction updates so Claude can propose `prepCron` at setup.
5. Update CLAUDE.md and the trivia management instruction file.

Rollback: revert the deploy. Existing question records with `postedAt === undefined` (staged but unposted) become invisible to the old code (which only looks at the active gen+post flow at fire time). Admins would need to manually clean up any staged records, or wait for the next deploy to re-enable prep handling.

## Open Questions

- **Should `list_games` surface a "next prep fire" timestamp?** Useful for admins eyeballing whether prep is scheduled correctly relative to question fire. Cheap to compute via `CronExpressionParser.parse(...).next()`. **Default:** include a `nextPrepFire` field per-entry alongside the existing schedule info, when `prepCron` is set. Mirrors the existing `nextQuestionFire` / `nextRevealFire` if present, or adds them as a triple.
- **Should the PREP prompt include a "validate everything is staged" assertion at the end?** A final `find_previous_questions({ posted: false, seasons: ["current"] })` call after the last save, confirming `slotCount` staged records exist. **Default:** yes — cheap insurance against a silent partial run. Adds ~3 lines to the prompt and one tool call.
- **Should orphaned staged questions from format-removed slots be visible in `list_games`?** An admin reading the output sees "you have 4 staged for game foo but the format has 3 slots — one is orphaned." Marginal value; defer unless admins ask.
