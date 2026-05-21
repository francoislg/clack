## Context

The trivia plugin today answers questions through public Slack reactions only. Boolean uses `+1`/`-1`, choice uses `one`/`two`/`three`/`four`, and the reveal flow categorizes voters by reading the message's current reactions. Free-form answers cannot fit this model — there's no reaction alphabet that captures "the user typed 'Paris'." The only viable Slack primitive for arbitrary text input is a modal (`views.open` triggered by an action button, with a `view_submission` event for the user's submission).

This change relies on two prerequisites: (1) `add-plugin-interactivity-sdk` exposes `sdk.registerAction` and `sdk.registerView` so the plugin can own its modal flow without editing core Slack handlers; (2) `add-trivia-topical-questions` introduces the `answersFormat` field name and the orthogonal `questionType` axis. Both must merge before this branch is opened.

A second piece is the reveal-time judge. Free-form answers can't be scored by exact string compare — "Paris" vs "paris" vs "Paris, France" vs "the city of Paris" all need to be recognized. A small fast model (Haiku 4.5) batched once per reveal-batch is the right tool: it handles semantic equivalence, multi-guess detection, and gradingNotes-driven edge cases for a few cents per round.

Stakeholders: trivia game admins (who configure freeform weights), end users (who answer via the modal), Claude (which generates the questions + expected answers), and the Haiku judge instance (which scores at reveal).

## Goals / Non-Goals

**Goals:**

- Make `answersFormat: "freeform"` a first-class generation/storage/reveal path alongside boolean and choice.
- Keep the during-round UX silent: no public signal of who has or hasn't answered. The competitive surprise lands at reveal.
- Allow answer edits up until reveal. Lock once `processedAt` is stamped.
- Score answers via a batched Haiku call from inside `process_reveal_answers` — exactly one model call per reveal-batch.
- Reject multi-guess shotgun answers (e.g. "Paris or London") at reveal via prompt-level instruction, not via a static gate.
- Reveal payload shows each player's quoted answer with the verdict — same auditability as choice reveals.
- Zero migration: all new schema is optional; legacy data flows through unchanged.

**Non-Goals:**

- Multi-turn or interactive judging. The judge is a single batched call; no follow-up clarification with the model.
- Confidence scoring or partial credit. The judge returns boolean correctness only.
- Cross-user answer collision detection ("two players said 'Paris' — only one gets points"). Each user is scored independently.
- A static submit-time gate on multi-guess answers. Per user direction, all multi-guess detection lives in the judge prompt.
- Surfacing the user's pending answer to anyone before reveal. The modal is the only surface; no DMs, no ephemeral confirmations.
- Reverse compatibility for `correct: boolean` in legacy callers. Type widens; old code that did `if (correct)` continues to work (undefined is falsy), and tightening to `=== true` happens in the same PR.
- Per-question custom timeout for the judge. One global timeout (e.g. 30s) handles every reveal.
- Per-user attempt limits (some quizzes restrict to one submission per question). Edits are unlimited until reveal.

## Decisions

### Decision 1: Pending rows live in the same `SubmittedAnswer` collection with `correct: undefined`

Per the conversation: store free-form answers in `answers.json` alongside boolean/choice rows, with `correct?: boolean` (undefined = pending). Readers tighten to skip pending rows; the leaderboard does NOT count them toward `totalAnswered`.

**Why not a separate `PendingFreeFormAnswer` collection?** Considered. Pro: keeps `SubmittedAnswer` invariant ("this row is scored"). Con: every reader that walks answers (leaderboard, history, reveal payload) needs to also walk the second collection or risk silently missing in-flight state. One collection with one consistent skip-pending rule is fewer moving parts.

**Why count pending rows as neither answered nor correct (rather than "answered but not yet correct")?** Mid-round, a player who has typed an answer but not seen the reveal shouldn't have their accuracy temporarily worsen. "Answered" implies a graded answer in the leaderboard's existing semantics; pending breaks that contract. Skip them entirely until graded.

**Trade-off:** Five existing readers need to learn the pending-row rule (`computeLeaderboard.ts`, `submitAnswers.ts`'s stat aggregation, `getQuestionHistory.ts`, `retrieveScores.ts` via `computeLeaderboard`, and `processRevealAnswers.ts`'s own counters). All five live in this PR. Audited via grep on `.correct`.

### Decision 2: Row identity via `(userId, questionId)` composite key (no new `id` field)

The existing `SubmittedAnswer` shape has no `id` field — uniqueness is implicit per `(userId, questionId)` (a user has at most one answer per question; submit_answers' write semantics already assume this). For the new `updateAnswer` op, we use the same composite as the row key rather than introducing a synthetic UUID.

**Why not add `id: string`?** It would be a new field on every row and no existing reader needs it. The composite key is already unique by domain invariant; adding `id` solves no real problem and creates a backfill question for legacy rows.

**Trade-off:** The op's signature is `updateAnswer(userId, questionId, partial)` (or a `{ userId, questionId }` key object) — slightly noisier than `updateAnswer(id, partial)`. Acceptable.

### Decision 3: Modal write path bypasses `submit_answers`

Free-form answers are written by the trivia plugin's `view_submission` handler directly through `data.forGame(name).saveAnswer(...)` (and `updateAnswer(...)` on edit). `submit_answers` (the MCP tool) remains the boolean/choice surface for Claude — it does NOT learn to accept free-form rows.

**Why?** `submit_answers` is invoked by Claude in a Q&A session; its semantics are "Claude is reporting a batch of reactions it collected." Free-form rows aren't reactions and don't come from Claude — they come from the user typing into a modal. Routing both through the same tool would force `submit_answers` to handle two very different write semantics. Cleaner to keep the boundary.

**Trade-off:** The data-layer's `saveAnswer` is now called from two code paths (the MCP tool and the modal handler). Both go through the same validated entry point, so this is just two callers, not two duplicated write logics.

### Decision 4: Inline Haiku judge in `process_reveal_answers` via `sdk.askClaude`

The reveal tool gets a new dependency on `sdk.askClaude` (added in this PR — see Decision 5). When the batch contains freeform questions with pending rows, the tool constructs a single batched prompt and parses the JSON-array response.

**Why one call per reveal-batch, not one per question?** Cost and latency. Five questions × twenty players = 100 submissions. One call with structured-output instructions handles them in a single 1–2s roundtrip; 100 calls would be 100× the cost and serial latency.

**Prompt shape:** A system prompt establishes the judge role and the multi-guess rule. The user message contains a numbered list of questions, each with its expected answer and submissions:

```
Q1: "What is the capital of France?"
   Expected: Paris
   Acceptable variants: Paris, France
   Notes: (none)
   Submissions:
     [1.1] user U1: "paris"
     [1.2] user U2: "Paris or London"
     ...
```

The judge returns a JSON array of `{ key, correct, reason }` entries that the tool maps back to rows by index.

**Why JSON-array response, not structured outputs?** Anthropic SDK supports a structured-output system, but in-message JSON is simpler and well-supported in older API versions. The parser is one line of `JSON.parse` plus a Zod schema validation; failure modes (malformed response, missing entries) trigger a retry-then-fall-back path that marks unmatched rows as `correct: false` with reason `judge-error` — so a Haiku misfire never leaves rows permanently pending.

**Trade-off:** Adds an Anthropic API call to the reveal hot path. Latency budget for `process_reveal_answers` was previously "fast" — now it's "fast + Haiku call." For a typical 30-player game, Haiku at 1k input tokens + 200 output is ~$0.001 per reveal. Acceptable.

### Decision 5: `sdk.askClaude` exposes a thin single-turn primitive

Plugin SDK gains `askClaude({ model, system?, messages, max_tokens, temperature? }) → { text, stopReason, usage }`. It uses the Anthropic SDK already transitively in the dependency tree (via `@anthropic-ai/claude-agent-sdk`) and reuses `process.env.ANTHROPIC_API_KEY`.

**Why expose this on the SDK rather than have the plugin import `@anthropic-ai/sdk` directly?** Two reasons. First, plugins should not manage credentials themselves — the SDK is the single trusted surface for auth-sensitive operations. Second, the SDK can later add telemetry, rate-limiting, or caching uniformly across plugins without each plugin reinventing it.

**Why so thin?** This is the first consumer. A richer API (streaming, tool use, retries, conversation state) has zero current need. Land the minimum useful surface; expand when a second consumer appears with concrete requirements.

**Alternative considered:** Bundle the helper into `add-plugin-interactivity-sdk`. Rejected because interactivity (Slack) and Claude calls are conceptually unrelated; bundling them muddles the SDK foundation. Better to add `askClaude` with its real consumer (this PR).

### Decision 6: Multi-guess detection lives only in the judge prompt

No static gate, no submit-time refusal. The judge prompt explicitly instructs Haiku: *"Treat any answer that hedges between two or more distinct guesses (e.g., 'Paris or London') as incorrect with reason `multiple-guess`, even if one guess matches. Single answers with qualifiers or parentheticals (e.g., 'Tokyo, Japan', 'Paris (France)') are valid single guesses."*

**Why prompt-only?** Per user direction: avoid a static refusal. Friction at submit time interrupts gameplay; a Haiku judge that knows the rule catches abuse without the user-facing block. The reveal text can name the reason (`multiple-guess`) so players understand why the shotgun didn't work.

**Risk:** Haiku misclassifies edge cases. → **Mitigation:** Test the judge prompt against a fixture set of qualifier-vs-shotgun cases during implementation. Iterate prompt wording until classifications are stable.

### Decision 7: Modal renders question statement read-only; lock view after reveal

The modal layout:

```
Question (read-only display block):
  <statement>

Your answer (plain_text_input, single line, optional initial_value):
  <prior pending text or empty>

Submit button (default)
```

After `processedAt` is stamped, opening the modal renders:

```
Question:
  <statement>

You answered: "<answerText>" — Correct! / Incorrect (reason: <reason>)
   — or —
You did not submit an answer for this question.

(no submit button)
```

**Why show the statement in the modal?** Once the modal opens, the parent message scrolls away in Slack. The statement reminds the user what they're answering without forcing them to dismiss and re-find the question.

**Why lock rather than refuse the modal?** A locked read-only view is friendlier than "this question is closed" + dismiss. It also gives the user a record of their submission, which they otherwise can't see (no public signal).

### Decision 8: Action ID encodes question ID via colon-suffix

The button's `action_id` is `plugin:trivia:freeform-answer:<questionId>`. The plugin registers the handler with the SDK using a RegExp matcher (`/^freeform-answer:[a-z0-9-]+$/`). The handler reads the `action_id` to extract the question ID for the modal-open call.

**Why encode the question ID in the action_id rather than the button's `value` field?** Both work, but the `action_id`-encoded form is greppable, survives a payload that doesn't include the message blocks, and matches the convention used elsewhere (e.g. Home Tab's `cron_edit_job:42`). The `value` field stays available for future use.

**Symmetric for views:** Modal `callback_id` is `plugin:trivia:freeform-modal:<questionId>` (the SDK auto-prefixes `plugin:trivia:`). The view-submit handler extracts the question ID from the callback_id.

## Risks / Trade-offs

- **[Risk] Haiku rate limit or outage stalls reveals.** A misfire at reveal time means rows stay pending. → **Mitigation**: One retry with exponential backoff inside `process_reveal_answers`; if the retry also fails, mark unmatched pending rows with `correct: false` reason `judge-error` and emit a clear error in the reveal payload so the renderer can surface it ("the auto-judge couldn't reach the model — admins can re-run reveal with `reprocessQuestionIds` once the issue clears").

- **[Risk] Haiku misjudges semantic equivalence.** "Football" vs "soccer" — should be accepted by gradingNotes; without notes, who knows. → **Mitigation**: Default to strict judging; encourage Claude to populate `acceptableAnswers` and `gradingNotes` at generation time for ambiguous topics. Test fixtures cover known-tricky cases.

- **[Risk] User submits while reveal is in flight.** Race: modal-submit fires after `process_reveal_answers` has read pending rows but before it commits. → **Mitigation**: The view-submit handler reads the current question record; if `processedAt` is set, the handler rejects the submission. Lock is enforced at write time, not just at modal-open time.

- **[Risk] Modal opens with stale state in the question.** A user opens the modal seconds before reveal closes it; they type and hit submit after `processedAt` is stamped. → **Mitigation**: As above — write-time lock check. The user sees a `view_submission` error from the modal ("answers are now closed"); their text is lost. This is acceptable for a corner case; we don't optimistically buffer.

- **[Risk] Two browsers / two devices for the same user produce divergent edits.** Last-write-wins by timestamp. → **Accepted**: Standard Slack-client semantics; no merge logic needed.

- **[Risk] `sdk.askClaude` is a small new attack surface.** A malicious plugin (we don't have any, but conceptually) could spam Claude calls with the bot's credential. → **Accepted**: Plugin code is trusted (it's checked into the same repo); same as `getSlackClient` exposing the bot's Slack token. No new exposure delta.

- **[Trade-off] Six-way prompt matrix is large.** Adding freeform doubles the topical paths. → **Accepted**: Auditability of explicit paths outweighs DRY for now. Same trade-off accepted in the topical change for the 4-way matrix.

- **[Trade-off] No timeout limit on `sdk.askClaude`.** A hung Anthropic request would hang the reveal. → **Mitigation**: Set an internal default timeout (30s) on the askClaude call and document it. Plugin authors can override if needed.

## Migration Plan

This change is purely additive — no schema rewrites, no data migration.

1. Land `add-plugin-interactivity-sdk` (prerequisite).
2. Land `add-trivia-topical-questions` (prerequisite — the `answersFormat` rename, the `{fact, topical}` axis, the topical generation paths).
3. Land this change in one PR:
   - SDK additions (`askClaude`).
   - Type widening (`SubmittedAnswer.correct?`, `answerText?`).
   - Reader tightening (leaderboard, stat aggregation, history).
   - Question schema additions (`expectedAnswer`, `acceptableAnswers`, `gradingNotes`).
   - `save_question` validation extensions.
   - `post_questions` Block Kit branch for freeform.
   - Trivia plugin init: `sdk.registerAction` + `sdk.registerView` for the modal flow.
   - Modal Block Kit builder + open / submit handlers.
   - Judge prompt module + parser.
   - `process_reveal_answers` integration: detect freeform → batch → call → updateAnswer.
   - Six-way scheduled prompt matrix.

**Rollback:** Revert the PR. Pending freeform rows (if any were written before revert) become orphaned; an admin can manually delete them via the answers store, or the post-revert code skips them (the `correct?` reader handling stays intact via the existing fallthrough).

## Open Questions

- **Should the judge accept gradingNotes that say "accept any answer"?** A pathological case — does Claude trust a notes field that says everything is fine? We treat notes as a hint, not an override; the judge prompt language can clarify ("notes refine your judgment but do not override the expected answer"). Punted to prompt iteration.
- **Should the modal pre-fill the user's answer when they re-open after submit?** Yes — captured in the spec. But should it pre-fill from the modal's own state if the same browser session reopens after a network error? Probably yes; minor UX polish; can be added if it surfaces.
- **Should we add `judgeModel` to game-level config?** A trivia admin might want to use Sonnet for higher-stakes games. Default decision: hardcode Haiku 4.5; add config later only if needed.
- **How does this interact with `add-trivia-game-namespacing` and `add-trivia-visual-questions` (both in flight)?** Game namespacing should be a no-op for this change (we're already working per-game). Visual questions may eventually overlap with the modal flow (a visual-answer mode could also use a modal). Sequencing is independent; rebase against whatever lands first.
