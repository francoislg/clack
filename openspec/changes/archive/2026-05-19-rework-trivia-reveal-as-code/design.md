## Context

The reveal-time flow lives in `src/plugins/trivia/scheduledPrompts.ts` as a giant prompt (`PROCESS_RESPONSES_INSTRUCTIONS`) plus a conditional mutator (`buildSeasonsAwarePrompt`). At runtime, the reveal cron job fires Claude with this prompt and a `requiredTools` allowlist of 5–6 tools. Claude orchestrates:

1. `fetch_channel_messages` — pull 20 messages from the channel and scan for the most recent question
2. `find_previous_questions` — fuzzy keyword search to map the extracted statement back to a stored `questionId`
3. `get_question_history` — fetch the question's stored truth + the list of cheater user IDs
4. (seasons) `check_season_status` — determine whether today is the last fire of the current season
5. `submit_answers` — score and persist the categorized votes
6. `retrieve_scores` — fetch the leaderboard for the result table
7. (seasons + last fire) `upsert_season` x2 — close the current season, open a continuation
8. `submit_response` — render the final Slack message

Steps 1–7 contain no creative work. They exist in the prompt because, when the original reveal flow was written, the only mechanism for "run code in the middle of a Claude session" was "register an MCP tool and tell Claude to call it." We then enumerated each step as its own tool. The result is a brittle prompt with extensive guardrails ("INTERNAL STEP, NEVER SURFACE," "SILENTLY VOIDED," "do not mention cheaters") that exist to prevent Claude from leaking data it has no business seeing — data we could simply withhold by computing the result server-side.

This change consolidates steps 1–7 into a single MCP tool (`process_reveal_answers`) and shrinks the prompt to a renderer brief. The cron scheduler, plugin SDK, and cron-job persistence layers are unaffected — the shift is a refactor of trivia internals plus a prompt rewrite, not a framework change.

## Goals / Non-Goals

**Goals:**

- Eliminate fuzzy-keyword-based question lookup at reveal time. The reveal targets the oldest question for the game where `postedAt && !processedAt`, looked up directly by field.
- Make cheater exclusion and multi-react voiding structural rather than prompt-enforced — the renderer payload literally cannot contain users it shouldn't surface.
- Support admin-initiated reprocessing (e.g. "I just flagged a cheater on yesterday's question — redo it") via a single tool call.
- Support replay (`asOf`) without making Claude thread the date through tool args — the tool reads it from the session context.
- Keep all existing per-tool semantics intact for ad-hoc admin use. `submit_answers`, `get_question_history`, `find_previous_questions`, `retrieve_scores`, `check_season_status`, and `fetch_channel_messages` remain registered tools with unchanged behavior.
- Move season-end rollover into the new tool so the reveal prompt no longer needs a conditional "step 12" splice.

**Non-Goals:**

- Multiple questions per day in the same game. The tool's payload shape (`reveals: Array<...>`) accommodates it for future extension, but the cron-driven path processes one question per fire and the renderer prompt is scoped to the single-reveal shape.
- Introducing a general "codeflow" framework. An early design draft proposed a scheduler-level pre-step that runs before Claude; this collapsed to "a better MCP tool" once we recognized the existing tool-registration mechanism already runs deterministic code at the right point.
- Changing the question-posting flow. `SEND_QUESTIONS_INSTRUCTIONS` and its tools stay as-is. The creative work (write a statement, validate, gate difficulty) remains Claude-driven.
- Changing the cron scheduler, plugin SDK, or cron-job persistence layer.
- Soft-deleting `SubmittedAnswer` rows on reprocess. We hard-delete and re-derive — the Slack reactions are the source of truth and the cron `runs[]` history provides audit trace.
- A `perUserSummary` digest projection. Only useful when N>1 questions per day, which is non-goal.

## Decisions

### Decision 1: One mega-tool over composed sub-tools

**Choice:** A single `process_reveal_answers` tool that, in one call, fetches the Slack message, resolves the question by `processedAt`, categorizes voters, persists answers, computes the leaderboard, and (if applicable) performs season rollover.

**Alternative considered — composed:** Several smaller tools (`get_pending_reveals`, `commit_reveals`, `compute_leaderboard`, `rollover_season`) chained by the prompt. This is theoretically more flexible.

**Rationale:** The "flexibility" is fictional — nothing else needs "the unprocessed-questions analysis without the leaderboard." Composed tools would require the prompt to orchestrate ordering (which can drift) and would re-introduce the "Claude as workflow engine" anti-pattern this change is eliminating. The mega tool is atomic, idempotent on processedAt, and trivially mockable in tests. We do extract a shared `computeLeaderboard` helper internally so the existing `retrieve_scores` tool and the new tool share aggregation logic.

### Decision 2: `processedAt` as a single boolean-shaped marker on the question

**Choice:** Add `processedAt?: number` (epoch ms) on `TriviaQuestion`. Default-mode picks the oldest question where `postedAt && !processedAt`.

**Alternatives considered:**

- **Pending-queue file** (`games/<name>/pending-reveals.json`): extra state file, duplicates information already implicit in the question rows. Easier to inspect but a second source of truth.
- **Reveal-side pointer** ("last revealed at TS X, look for questions newer than X"): couples reveal logic to time and breaks if cron jobs run out of order.

**Rationale:** `processedAt` lives alongside `postedAt` on the same row. Inspecting "what's pending" is a one-line filter, no extra file to keep in sync. Legacy rows lacking the field are treated as "never processed" — harmless for back-fill (they're either old questions whose reveals long since ran or, if a back-fill becomes a real concern, the tool's default mode can restrict its scan to questions created after a cutoff; we don't ship that scaffolding now).

### Decision 3: `reprocessQuestionIds: string[]` over `reprocess: boolean + questionId`

**Choice:** Single array argument. When present and non-empty, the tool processes ONLY those IDs (hard-delete existing answers, re-derive from current reactions, re-stamp `processedAt`). When absent or empty, the tool processes the oldest pending question (cron default).

**Alternative considered:** `{ reprocess: boolean, questionId?: string }`. Two arguments, one toggling destructive intent.

**Rationale:**

- A single field carries both intent (reprocess) and target (which IDs) — they're inseparable, so coupling them in one parameter prevents nonsense combinations like `{ reprocess: true, questionId: undefined }` (reprocess what?).
- Naturally supports the killer admin case: "I flagged Marc on three questions yesterday, redo all three" — one tool call, three IDs.
- Default-mode and reprocess-mode are mutually exclusive on purpose: mixing them ("reprocess these AND also catch up on pending") creates surprises. If an admin wants both, they make two calls.

### Decision 4: Hard-delete `SubmittedAnswer` rows on reprocess

**Choice:** When a question is reprocessed, the tool deletes all existing `SubmittedAnswer` rows for that questionId before re-deriving from current reactions.

**Alternative considered:** Soft-delete (mark `voidedAt`, keep rows).

**Rationale:** The Slack message and its current reaction state are the canonical source of truth. The Slack post itself is the audit trail (the original reveal is still in channel history; a new reveal post is the corrected announcement). The cron `runs[]` array on the job records that a reveal happened. Soft-delete adds complexity (filtering everywhere that reads SubmittedAnswers) for an audit value already covered by Slack + cron history.

### Decision 5: `asOf` plumbed via tool context, not as a tool argument

**Choice:** Extend `QueryToolContext` with `asOf?: Date`. `cronScheduler.executeJob` populates it when invoked with an explicit `asOf` (the existing replay path). The tool reads from context, not from Zod args.

**Alternative considered:** Add `asOf?: string` to the tool's Zod schema; rely on the existing `REPLAY CONTEXT` system-prompt injection to nudge Claude to pass it.

**Rationale:** The context-injection approach is invisible to Claude — no risk of "Claude forgot to pass asOf in the replay." It also generalizes cleanly: any future time-sensitive tool can read `ctx.asOf` and behave correctly under replay. Claude-arg threading is brittle and adds an undocumented coupling between the system prompt and the tool's schema.

### Decision 6: Season rollover inside the tool, not orchestrated by the prompt

**Choice:** When the tool detects `isLastFireOfSeason`, it stamps `endedAt` on the closing season and (if no continuation is queued) creates a new season inline, then returns the outcome in `seasonStatus.seasonClosed` and `seasonStatus.newSeasonStarted`.

**Alternative considered:** Return `isLastFireOfSeason` in the payload and let the renderer prompt call `upsert_season` as a follow-up step (current pattern).

**Rationale:** This was the exact same anti-pattern as the rest of the reveal — deterministic work narrated in English. Moving it inside the tool kills the "step 12 only when isLastFireOfSeason is true" prompt branching and the `SEASONS_LEADERBOARD_OVERRIDE` / `buildSeasonsAwarePrompt` machinery. New-season slug derivation is the one piece that's not purely mechanical — it consults `trivia.seasons.prompt` for style/cadence guidance. The tool generates the slug from a deterministic template (e.g. month-based: `season-2026-05`); if `trivia.seasons.prompt` calls for a themed slug, that work moves into the question-posting flow at season-creation time (out of scope here — the tool's continuation-creation falls back to the default category baseline when no theme is specified). Open question: whether this is acceptable for current users — flagged below.

### Decision 7: Direct Slack API call inside the tool, not via `fetch_channel_messages`

**Choice:** The tool calls `client.conversations.replies` (or `conversations.history` keyed by exact TS) to fetch the targeted question message. It does not invoke the `fetch_channel_messages` MCP tool internally.

**Rationale:** `fetch_channel_messages` is a Claude-facing convenience wrapper (pull last N, transform usernames, etc.). The tool already knows the exact `messageTs` of the question (stored in `question.messageTs` at posting time), so it just needs one message. Calling the Slack API directly is one network call vs the wrapper's 20-message pull + scan. The wrapper stays registered for ad-hoc admin queries.

### Decision 8: Renderer prompt scoped to single-reveal shape

**Choice:** Even though the payload is `reveals: Array<...>`, the renderer prompt explicitly assumes `reveals.length === 1` for cron-driven runs. Admin-initiated multi-reprocess (`reprocessQuestionIds: [Q1, Q2, Q3]`) produces a multi-element array, which the renderer handles by emitting one Slack post per reveal sequentially.

**Rationale:** Keeps the renderer brief simple (current trivia UX is one-reveal-per-fire). Multi-element rendering is the admin's job to interpret — Claude can iterate. If we later support N questions per day, the renderer prompt expands to handle the digest shape; nothing about the payload contract changes.

## Risks / Trade-offs

- **Risk:** `processedAt` is set before the reveal is actually delivered. If `submit_response` errors after the tool returns, the question is marked processed but never revealed. → **Mitigation:** existing cron error notification (`notifyCreatorOfError` in `cronScheduler.ts`) DMs the owner with the failure. Recovery: admin runs `process_reveal_answers` again with `reprocessQuestionIds: [<id>]` to redo. We accept this trade-off: stamping after delivery would require a second tool call ("confirm_reveal") that Claude could forget, which is worse than the current rare-failure path.

- **Risk:** Hard-deleting `SubmittedAnswer` rows on reprocess loses the original scoring snapshot. → **Mitigation:** The original reveal post in Slack preserves the user-visible record; the cron `runs[]` array preserves the run history. The data we're losing is "who answered first vs after the cheater was flagged" — not load-bearing for any current workflow.

- **Risk:** Season-rollover logic moving inside the tool means the new-season slug is derived programmatically (e.g. month-based) rather than by Claude reading `trivia.seasons.prompt` for theme guidance. Workspaces relying on themed slugs lose that capability on auto-rollover. → **Mitigation:** Admin-initiated mid-season rollover via `upsert_season` (still a registered tool) lets admins set themed slugs explicitly when desired. We surface this trade-off in the open questions; if it's a blocker, we can keep the slug-derivation path Claude-driven (tool returns "rollover required" and the renderer prompt has a small extra step). Default behavior in this proposal is auto-derivation.

- **Risk:** The shrunk renderer prompt has less explicit guidance than today. → **Mitigation:** because the payload is structured (categorized voters, sorted leaderboard, season status), the renderer's job is constrained — there's less room for Claude to invent steps. Tests verify the rendering shape on a fixed payload.

- **Trade-off:** The new tool has a wide surface (it absorbs 6 tools' worth of logic). It will have substantial test coverage requirements. → **Acceptable:** the alternative is leaving the orchestration in a 250-line prompt, which is much harder to test deterministically. Mocking a tool's I/O is straightforward; mocking Claude's behavior on a prompt is not.

- **Trade-off:** Tools that leave the hot path (`submit_answers`, `find_previous_questions`, etc.) are still registered, so the plugin has more tools than strictly necessary for the cron path. → **Acceptable:** they're useful for admin ad-hoc queries and their docstrings are accurate. Removing them would be a separate, larger change.

## Migration Plan

This change has no data migration — the `processedAt` field is optional and additive. Rollout in one PR:

1. Land the `processedAt` field type, the new tool, the shared helper, and the `asOf` context plumbing.
2. Update `buildGameSpecs.ts` so the reveal spec's `requiredTools` references the new tool and the prompt is the new renderer brief.
3. On next deploy, `reconcileCronJobs` updates the persisted reveal cron job in place (matched by `specKey`).
4. The next reveal cron fire uses the new flow.

**Existing in-flight cron sessions:** None — cron fires are short-lived (<a few minutes); no risk of in-flight sessions straddling the deploy.

**Rollback:** Revert the PR. The persisted cron jobs revert to the old prompt + requiredTools on the next reconcile. The `processedAt` field on questions persists harmlessly; the old reveal prompt ignores it.

**Backfill of `processedAt` for past questions:** Not needed. The tool's default mode only processes questions where `postedAt` is set but `processedAt` is unset. Questions revealed under the old flow have `postedAt` set but no `processedAt` — under the new flow they'd be flagged as "pending." → **Mitigation:** we either (a) ship a one-line back-fill that stamps `processedAt = postedAt` on all existing questions with `postedAt` set, or (b) the tool's default mode requires `question.createdAt > <deploy timestamp>` to be eligible for catch-up. Option (a) is cleaner; option (b) is safer if back-fill scripts spook us. Pinned as an open question.

## Open Questions

1. **Auto-rollover slug derivation:** Decision 6 derives new-season slugs programmatically (e.g. month-based fallback). Is that acceptable for workspaces that currently let Claude generate themed slugs (e.g. "marine-season") based on `trivia.seasons.prompt`? If not, we keep slug derivation Claude-driven: the tool returns `seasonClosed: true` + `newSeasonRequired: true`, and the renderer prompt has a small follow-up step. Asks more of the prompt but preserves themed-slug behavior.

2. **`processedAt` back-fill at deploy time:** Option (a) — one-shot script stamps `processedAt = postedAt` on existing questions; or option (b) — the tool's default mode only considers questions created after the deploy timestamp. Need to decide which before merge.

3. **Pending-question budget:** Should the tool's default mode have a sanity cap (e.g. "if more than 5 questions are pending for this game, refuse to process — something is wrong")? Today, if the reveal cron is broken for a week, the next successful fire would process the week-old question and the next 6 days' worth would still be pending. A sanity cap protects against runaway catch-up; absence of one means the tool is dumber but more predictable. Recommend: no cap initially; add if it ever bites.

4. **`reprocessQuestionIds` and stale-cheater state:** When reprocessing, the tool uses the _current_ cheaters list — which is the whole point. But this means an admin who reprocesses an old question after weeks of cheating-detection activity may "rescore" a question with a longer cheaters list than was known at original-reveal time. Is that desired (newer data = better) or surprising (the original reveal was published with a different set of exclusions)? Default position: this is desired; it's literally the use case the feature exists to support. Worth calling out in the tool's docstring.
