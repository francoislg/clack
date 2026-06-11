## Context

Trivia question cards are posted by `post_questions`, which appends a per-format answer-actions block (vote buttons / freeform Answer button, plus an optional hint button) and stamps the **full** block array — buttons included — onto the record as `postedBlocks`. Two paths later repaint that card via `chat.update`, and both **rebuild from `postedBlocks`** rather than the message's current Slack state:

- `freeform/roster.ts:editRosterIntoCard` — fires on every vote/answer click, composing `[...postedBlocks, divider, rosterFooter]`.
- `revealCards/editCard.ts:editRevealIntoCard` — fires once at reveal, **stripping** the answer-actions block (by `block_id` prefix `vote-actions:` / `freeform-answer-actions:`) and appending the results footer + post-game buttons.

So the machinery to "remove the buttons by rebuilding from `postedBlocks`" already exists in the reveal path. Locking is the same strip, minus the reveal footer, plus a notice — driven by a flag rather than by reveal.

The lock trigger mirrors the existing optional `prepCron`: a per-game cron that emits an extra channelless `CronJobSpec`.

## Goals / Non-Goals

**Goals:**
- Freeze voting on posted questions at a configured time, visibly (buttons disappear, a "locked in" notice appears).
- Make lock a pure, reversible state transition: a single `answerLocked` flag the render path honors, with an admin `unlock_questions` escape hatch.
- Zero behavior change when `lockCron` is unset.
- Keep the reveal flow and question-generation flow untouched.

**Non-Goals:**
- Coupling to predictions. `lock_questions` is question-type-agnostic; a non-predictions game simply never sets `lockCron`.
- Preserving the live roster on the locked card (decided: replace it with the notice only).
- A per-game configurable notice string (decided: one localized default).
- Any change to scoring, seasons, or reveal rendering.

## Decisions

### Decision: A single `answerLocked` flag drives an "atomic" render, not a bespoke lock-card editor

**Choice:** Add `answerLocked?: boolean` to `TriviaQuestion`. The live-card rebuild branches on it:
- unlocked → `[...postedBlocks, divider, roster]` (today)
- locked → `[...stripAnswerButtons(postedBlocks), lockNotice]`

`lock_questions` / `unlock_questions` just flip the flag and rebuild; the rebuild is the only place that decides whether buttons render.

**Why over alternatives:** A separate `editLockIntoCard` sibling (my first sketch) duplicates the strip-and-update plumbing and creates a third independent card-render path that can drift. Driving everything off one flag honored by one rebuild keeps the card a pure function of record state — lock/unlock are symmetric and reversible for free (buttons live in `postedBlocks`, so unlocking re-emits them with no residue).

### Decision: Extract `stripAnswerButtons()` as a shared helper

`editCard.ts` already filters `postedBlocks` by `ANSWER_ACTIONS_BLOCK_PREFIXES`. Extract that filter (prefixes + filter) into a shared module (e.g. `revealCards/answerActions.ts`) and call it from both `editRevealIntoCard` and the locked rebuild. Single source of truth for "which block is the answer affordance," so a future affordance prefix is added once.

### Decision: `lock_questions` selects by record state, no batchId argument

Lock targets `postedAt !== undefined && processedAt === undefined && answerLocked !== true`. The lock cron has no prior tool output to hand it a `batchId` (unlike reveal, which gets one from `compute_answers`), and "freeze everything currently open" is the intended semantics. Idempotent and robust to multiple open batches.

### Decision: lock spec is channelless + `submitResponseMode: "skipped"` + minimal `requiredTools`

Mirror the prep spec's two structural defenses. The lock run edits existing cards via `chat.update` inside the tool and must post nothing, so `channel` is omitted (SDK locks `submit_response` to `{ skip_response: true }`) and `requiredTools` is just `["mcp__trivia__lock_questions"]` (no `post_questions`). Either defense alone suffices; both cost nothing.

### Decision: `unlock_questions` lives on the `trivia:management` on-demand server

Unlock is an admin recovery action, not part of the automated game loop, so it belongs with the other admin config-mutation tools (admin-gated, attached on demand). `lock_questions` stays on the always-on default server because the lock cron needs it available without an `attach_integration` step.

### Decision: Click/modal lockout sits beside the existing `processedAt` lockout

`clickHandlerInstaller.ts` already rejects post-reveal clicks (`processedAt !== undefined`) with an ephemeral notice. Add an `answerLocked === true` branch there (and in freeform's own modal registration) returning a localized "answers are locked" notice. Removing buttons can't stop an in-flight or stale-client click; this is the correctness backstop, the visual strip is the UX.

## Risks / Trade-offs

- **[Locked card loses the live roster]** → Intentional per product decision. For predictions this is desirable (don't leak who picked what before results). Unlock restores it from `answers.json` on rebuild.
- **[Notice wording is prediction-flavored on a fact game]** → A fact game would not configure `lockCron`; the single localized default ("locked in — waiting on results") reads acceptably regardless. Per-game wording is a deferred follow-up if ever needed.
- **[Lock cron fires before all questions are posted]** → Only currently-posted questions lock; a later-posted question stays votable until the next lock fire. Mitigated by admins scheduling `lockCron` after `questionCron` (a `warnIfLockBeforeQuestion`-style advisory could be added, mirroring `warnIfPrepAfterQuestion`, but is optional for v1).
- **[Reveal interaction]** → None. `editRevealIntoCard` strips the answer-actions block regardless of `answerLocked`, so a locked-then-revealed question renders identically to an unlocked-then-revealed one.
