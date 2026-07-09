## REMOVED Requirements

### Requirement: `update_answers_block` MCP tool projects file state onto posted cards

**Reason**: The tool is renamed `refresh_question_cards` (the old name described a Block Kit implementation detail, not the contract) and its projection becomes state-complete instead of revealed-state-only.
**Migration**: Covered in full by "`refresh_question_cards` MCP tool projects file state onto posted cards" and "Projection is state-complete" below.

### Requirement: `update_answers_block` appends stored `revealBlocks` when present

**Reason**: Tool renamed to `refresh_question_cards`; behavior unchanged.
**Migration**: Covered by "`refresh_question_cards` appends stored `revealBlocks` when present" below.

## ADDED Requirements

### Requirement: `refresh_question_cards` MCP tool projects file state onto posted cards

The trivia plugin SHALL register an `admin`-tier MCP tool named `refresh_question_cards` (callable as `mcp__trivia__refresh_question_cards`, replacing the former `update_answers_block`) taking `{ game: string, questionIds: string[] }` where `questionIds` is non-empty. The tool SHALL be the deterministic projector that edits already-posted trivia question cards into the state their record is currently in (see "Projection is state-complete") by reading the current `games/<game>/questions.json` + `games/<game>/answers.json` and calling `chat.update` once per **named** question. It SHALL be the **sole editor of already-posted question cards** in the reveal flow — the only other `chat.update` writers of a question message are the live-interaction editors (roster updates, lock/unlock transitions), which render the same live projection.

The tool SHALL NOT score answers, run the freeform judge, mutate season state, or post any new message. Its only effect is to bring each named card's Slack content in line with current file state. The rendering of a revealed card (preserve body, remove answer-actions block, append the static results footer per the question's stamped `revealResponses`, append the "See your answer" button) SHALL follow the rules specified in `trivia-reveal-cards`.

Selection SHALL be by question `id`: the tool repaints exactly the rows whose `id` appears in `questionIds`, in `postedAt`-ascending order, and SHALL leave every un-named row untouched. Duplicate ids within `questionIds` SHALL be de-duplicated — each named card is edited at most once. The tool SHALL NOT accept a `batchId`; the internal `batchId` join key is never part of its input.

The tool assumes scoring has already run when a revealed state is projected: it reads the CURRENT `answers.json` and never triggers scoring/judging itself, so callers run `compute_answers` first when verdicts must change.

On success the tool SHALL return a result of shape `{ game, edited: string[], notFound?: string[], errors?: Array<{ questionId, error }> }`: `edited` lists the ids whose cards were projected, `notFound` (present only when non-empty) lists requested ids matching no row in the game, and `errors` (present only when non-empty) lists per-card PROJECTION failures (a card whose target state could not be built — e.g. a missing/invalid answer key or an I/O error). A `chat.update` failure is swallowed and logged by the card editor (not surfaced in `errors`) and leaves the run retryable. The tool SHALL return an error result (editing no card) only when NONE of the requested ids match a row, or when `questionIds` is empty.

#### Scenario: Tool registers at admin tier under the new name

- **WHEN** the trivia plugin loads
- **THEN** `refresh_question_cards` is registered on the trivia MCP server with `minRole: "admin"`, callable as `mcp__trivia__refresh_question_cards`
- **AND** no tool named `update_answers_block` is registered

#### Scenario: Projects every named card

- **GIVEN** a batch of three processed questions `Q1`, `Q2`, `Q3` with scored rows in `answers.json`
- **WHEN** `refresh_question_cards({ game, questionIds: ["Q1", "Q2", "Q3"] })` is called
- **THEN** each of the three question messages is edited via `chat.update` into its revealed state
- **AND** each edited card follows the `trivia-reveal-cards` rendering rules for that question's stamped `revealResponses` mode

#### Scenario: Repaints only the named card, leaving siblings untouched

- **GIVEN** a still-live batch `Q1`, `Q2`, `Q3` where `Q2` was just invalidated
- **WHEN** `refresh_question_cards({ game, questionIds: ["Q2"] })` is called
- **THEN** only `Q2`'s card is edited (into its invalidated state)
- **AND** `Q1` and `Q3` keep their vote buttons and live state

#### Scenario: Unknown ids are reported, known ids still projected

- **GIVEN** a game containing `Q1` but not `ghost`
- **WHEN** `refresh_question_cards({ game, questionIds: ["Q1", "ghost"] })` is called
- **THEN** `Q1`'s card is edited
- **AND** the result is `{ edited: ["Q1"], notFound: ["ghost"] }`

#### Scenario: All-unknown ids return an error

- **GIVEN** a game containing none of the requested ids
- **WHEN** `refresh_question_cards({ game, questionIds: ["nope"] })` is called
- **THEN** the tool returns an error result and edits no card

#### Scenario: Empty questionIds is rejected

- **WHEN** `refresh_question_cards({ game, questionIds: [] })` is called
- **THEN** the tool rejects the call (schema-level non-empty validation) and edits no card

#### Scenario: Duplicate ids are de-duplicated

- **GIVEN** a game containing `Q1` and `Q2`
- **WHEN** `refresh_question_cards({ game, questionIds: ["Q1", "Q1", "Q2"] })` is called
- **THEN** each of `Q1` and `Q2` is edited exactly once
- **AND** the result is `{ edited: ["Q1", "Q2"] }` (in `postedAt` order)

#### Scenario: Tool performs no scoring, judging, rollover, or new post

- **WHEN** `refresh_question_cards` runs
- **THEN** no `answers.json` row is added or re-scored, no freeform judge call is made, no season entry is mutated, and no new Slack message is posted

### Requirement: Projection is state-complete

For each named question, `refresh_question_cards` SHALL determine the card's target state from the record alone, using this precedence (first match wins):

1. `invalidated: true` → the INVALIDATED card (answer affordances removed, "invalidated — <reason>" line appended; no results footer, no post-game buttons).
2. The question has an answer key (per the answer-format handler's `hasAnswerKey`) AND `processedAt` is set → the REVEALED card (results footer per `trivia-reveal-cards`, stored `revealBlocks` narrative when present, post-game buttons).
3. `answerLocked: true` → the LOCKED card (answer affordances removed, the locked notice shown), rendered identically to the `lock_questions` transition.
4. Otherwise → the LIVE card: the original answer affordances restored from the stored `postedBlocks` (vote/answer buttons, hint button when present) plus the current live roster footer.

The results footer SHALL NEVER be painted on a question whose `processedAt` is unset or whose answer key is absent — a keyed-but-unprocessed question repaints as live/locked, closing the previous behavior of leaking the answer. A question with no `postedBlocks` or no parseable `messageLink` (staged or legacy row) SHALL be skipped with a logged warning, exactly as today.

The LIVE and LOCKED renderings SHALL be produced by the same single projection path used by the lock/unlock transition and the live roster editor — there SHALL be exactly one implementation of each card state's rendering.

#### Scenario: Reopened unlocked pending prediction repaints to its live look

- **GIVEN** a keyless, unlocked prediction (`answerLocked` unset) whose card was painted invalidated, then reopened via `settle_question({ reopen: true })`
- **WHEN** `refresh_question_cards({ game, questionIds: [id] })` is called
- **THEN** the card is rebuilt from `postedBlocks` into its live state (answer buttons + roster restored)
- **AND** no results footer and no invalidated line appear

#### Scenario: Reopened locked pending prediction repaints to its locked look

- **GIVEN** a keyless prediction with `answerLocked: true` whose card was painted invalidated, then reopened via `settle_question({ reopen: true })`
- **WHEN** `refresh_question_cards({ game, questionIds: [id] })` is called
- **THEN** the card is rebuilt from `postedBlocks` into its locked state (buttons removed, locked notice shown)
- **AND** no results footer and no invalidated line appear

#### Scenario: Keyed-but-unprocessed question never shows the footer

- **GIVEN** a fact question with an answer key, posted but not yet processed (`processedAt` unset), and not locked (`answerLocked` unset)
- **WHEN** `refresh_question_cards` is called naming it
- **THEN** the card is projected to its live state
- **AND** the results footer and correct answer are NOT painted

#### Scenario: Reopened-after-reveal question repaints without the footer until re-settled

- **GIVEN** a prediction invalidated at/after reveal (`invalidated: true`, `processedAt` set), whose card was already painted in its invalidated state via `refresh_question_cards`, then reopened (keyless again, `processedAt` retained)
- **WHEN** `refresh_question_cards` is called naming it
- **THEN** the card is projected to its locked/live state (keyless → precedence rule 2 does not match)
- **AND** after the question is settled and reprocessed, a further call projects the revealed card with the results footer

#### Scenario: Invalidated state takes precedence

- **GIVEN** an invalidated question that also has an answer key and `processedAt` set
- **WHEN** `refresh_question_cards` is called naming it
- **THEN** the card is painted in its invalidated state (no results footer)

#### Scenario: Staged and legacy rows are skipped

- **GIVEN** a named question with no `postedBlocks` or no parseable `messageLink`
- **WHEN** `refresh_question_cards` runs
- **THEN** the card is skipped with a logged warning and the remaining named cards still project

### Requirement: `refresh_question_cards` appends stored `revealBlocks` when present

When projecting a question in its REVEALED state whose record carries `revealBlocks`, `refresh_question_cards` SHALL render the deterministic results footer (from `answers.json`, per the question's `revealResponses`) AND append the stored `revealBlocks` directly beneath the footer, before the "See your answer" button. When a question's record has no `revealBlocks`, the projection SHALL be unchanged from its facts-only behavior. The append SHALL be deterministic and idempotent — rebuilt each time from `postedBlocks` + footer + stored `revealBlocks`, never accumulating.

#### Scenario: Card with stored blocks shows footer then narrative

- **GIVEN** a processed question whose record has `revealBlocks`
- **WHEN** `refresh_question_cards({ game, questionIds })` projects it
- **THEN** the edited card contains the preserved question body, then the deterministic results footer, then the stored `revealBlocks`, then the "See your answer" button

#### Scenario: Card without stored blocks is unchanged

- **GIVEN** a processed question with no `revealBlocks`
- **WHEN** `refresh_question_cards` projects it
- **THEN** the card shows only the deterministic footer, identical to facts-only behavior

#### Scenario: Re-projection after re-authoring reconciles the narrative

- **GIVEN** a card already projected with `revealBlocks` v1, then `set_reveal_narrative` overwrites them with v2
- **WHEN** `refresh_question_cards` is re-run for the question
- **THEN** the card shows v2 narrative beneath the re-derived footer

## MODIFIED Requirements

### Requirement: Content-mutating tools surface a uniform repaint hint

Every trivia tool that mutates already-posted question or answer state — `settle_question` (invalidate, re-settle, reopen), `override_answer`, `remove_cheat` — SHALL include in its successful result a `refreshHint` **string** naming the exact repaint call to make next, in the literal format `refresh_question_cards(game, questionIds: ["<questionId>"])` for the affected question(s). The hint SHALL reference the question `id`(s) the tool just acted on and SHALL NOT reference a `batchId`. This is the single, uniform repaint path; the mutators never call `chat.update` themselves (no auto-repaint).

When a mutation needs a re-score before the card is accurate — `override_answer`, and `settle_question` re-settle (a corrected `outcome` on an already-keyed, already-revealed question) — the hint follows the tool's documented `compute_answers` reprocess step. When the affected question is NOT yet revealed (e.g. answering a still-pending prediction), there is no posted card to refresh and the tool MAY omit the hint.

#### Scenario: `settle_question` invalidate returns the repaint hint

- **WHEN** `settle_question({ game, questionId: "Q1", invalidate: true, invalidatedReason: "bad" })` succeeds
- **THEN** the result includes a `refreshHint` naming `refresh_question_cards(game, questionIds: ["Q1"])`

#### Scenario: `settle_question` reopen returns the repaint hint

- **WHEN** `settle_question({ game, questionId: "Q1", reopen: true })` succeeds for a question with a posted card
- **THEN** the result includes a `refreshHint` naming `refresh_question_cards(game, questionIds: ["Q1"])`

#### Scenario: `settle_question` re-settle of a revealed question returns the repaint hint

- **GIVEN** an already-revealed, already-keyed question `Q1`
- **WHEN** `settle_question({ game, questionId: "Q1", outcome: <corrected>, override: true })` succeeds
- **THEN** the result includes a `refreshHint` naming `refresh_question_cards(game, questionIds: ["Q1"])` (after the `compute_answers` reprocess step)

#### Scenario: `override_answer` returns the repaint hint

- **WHEN** `override_answer({ game, questionId: "Q1", userId, correct: true, reason })` succeeds
- **THEN** the result includes a `refreshHint` naming `refresh_question_cards(game, questionIds: ["Q1"])` (after any reprocess step)

#### Scenario: `remove_cheat` returns the repaint hint

- **WHEN** `remove_cheat({ game, cheaterUserId, questionId: "Q1" })` succeeds
- **THEN** the result includes a `refreshHint` naming `refresh_question_cards(game, questionIds: ["Q1"])`

### Requirement: Projection is idempotent and reconciling

`refresh_question_cards` SHALL be safe to call repeatedly. Each card SHALL be rebuilt deterministically from the question's stored `postedBlocks` plus the state-appropriate footer derived from current file state (never from the message's current Slack state), so repeated calls converge to the same final card and cannot accumulate stale blocks. Running the tool again after the record or `answers.json` has changed (e.g. a re-score, a disclosure re-stamp, an invalidation, or a reopen) SHALL reconcile the card to the new state. A `chat.update` failure for one card (deleted message, rate limit) SHALL be logged, SHALL NOT abort the rest of the named set, and SHALL leave the run retryable.

#### Scenario: Repeated projection converges

- **WHEN** `refresh_question_cards` is called twice in a row with no intervening file change
- **THEN** the second call produces a card identical to the first (rebuilt from `postedBlocks`, not from current Slack state)

#### Scenario: Re-projection after a re-score reconciles the card

- **GIVEN** a card already projected, then `answers.json` is corrected by a re-run of `compute_answers`
- **WHEN** `refresh_question_cards` is called again for the question
- **THEN** the card's results footer reflects the corrected verdicts

#### Scenario: Projection round-trips through invalidate and reopen

- **GIVEN** a live question that is invalidated, repainted, then reopened
- **WHEN** `refresh_question_cards` is called after each mutation
- **THEN** the card converges to the invalidated state after the invalidation and back to its live/locked state after the reopen, with no leftover blocks from the previous state

#### Scenario: One card's chat.update failure does not abort the set

- **GIVEN** three named questions `Q1`, `Q2`, `Q3` where the `chat.update` for `Q2` fails (deleted message or rate limit)
- **WHEN** `refresh_question_cards` runs
- **THEN** `Q1` and `Q3` are still projected
- **AND** the `Q2` failure is logged and swallowed by the card editor, the call still returns, and the run remains retryable (a re-run reconciles `Q2`)

#### Scenario: A projection failure is reported in `errors`

- **GIVEN** a named question whose target state cannot be built (e.g. a choice question with an invalid `correctIndex`)
- **WHEN** `refresh_question_cards` runs
- **THEN** no card is edited for it and the result's `errors` contains `{ questionId, error }` for that question

#### Scenario: Repair primitive after partial failure

- **GIVEN** a reveal where `compute_answers` succeeded but the card edits failed midway
- **WHEN** an admin re-runs `refresh_question_cards({ game, questionIds })` with the revealed ids
- **THEN** all named cards are reconciled to current file state without re-scoring
