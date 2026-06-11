# trivia-question-locking Specification

## Purpose

Freeze voting on posted trivia questions at a configured time, well before the reveal. Built for prediction games — lock picks at an event's kickoff so nobody changes their answer once the outcome starts to unfold — but type-agnostic: a lock simply freezes whatever questions are currently open. Centered on a single `answerLocked` flag the live-card render honors, with a `lockCron`-driven schedule, a `lock_questions` tool, an admin `unlock_questions` escape hatch, and a click/modal lockout.

## Requirements

### Requirement: answerLocked flag on TriviaQuestion

The `TriviaQuestion` record SHALL carry an OPTIONAL `answerLocked?: boolean` field, persisted in `games/<game>/questions.json`. The field is the single source of truth for whether a posted question still offers its answer affordance. It SHALL be modeled in the graceful persisted-state zod schema as optional with no `.strict()` and no coercion; an absent field SHALL read as unlocked (equivalent to `false`). A legacy record with no `answerLocked` field SHALL load unchanged and behave as unlocked.

#### Scenario: Absent flag reads as unlocked

- **GIVEN** a `questions.json` record with no `answerLocked` field
- **WHEN** the questions are loaded
- **THEN** the record loads successfully
- **AND** it is treated as unlocked (its card still offers answer buttons)

#### Scenario: Flag round-trips through persistence

- **GIVEN** a question record stamped with `answerLocked: true`
- **WHEN** the questions are reloaded from disk
- **THEN** the record carries `answerLocked: true`

### Requirement: lock_questions tool freezes posted questions

The trivia tool server SHALL expose a `lock_questions(game)` MCP tool. When called it SHALL select every question in the named game that is posted (`postedAt !== undefined`), not yet revealed (`processedAt === undefined`), and not already locked (`answerLocked !== true`); for each such question it SHALL set `answerLocked: true` and repaint its Slack card into the locked layout (see the trivia-question-posting render requirement). The tool SHALL be idempotent — re-running it makes no change to already-locked questions — and per-card isolated: a `chat.update` failure on one card SHALL be logged and SHALL NOT abort the rest of the batch. The tool SHALL post no new Slack message. It SHALL refuse a missing or disabled game via `requireWritableGame`.

#### Scenario: Locks all posted, unrevealed questions

- **GIVEN** a game with two posted, unrevealed, unlocked questions
- **WHEN** `lock_questions({ game })` is called
- **THEN** both records are stamped `answerLocked: true`
- **AND** each card is repainted without its answer buttons

#### Scenario: Skips revealed and already-locked questions

- **GIVEN** a game with one revealed question (`processedAt` set) and one already-locked question (`answerLocked: true`)
- **WHEN** `lock_questions({ game })` is called
- **THEN** neither record is mutated
- **AND** no card edit is attempted for them

#### Scenario: Idempotent re-run

- **WHEN** `lock_questions({ game })` is called twice in succession
- **THEN** the second call makes no record mutation and reports nothing newly locked

#### Scenario: Per-card edit failure is isolated

- **GIVEN** two lockable questions where the first card's `chat.update` fails
- **WHEN** `lock_questions({ game })` is called
- **THEN** the failure is logged
- **AND** the second card is still repainted and stamped

### Requirement: unlock_questions admin tool restores voting

The `trivia:management` on-demand MCP server SHALL expose an admin-gated `unlock_questions(game)` tool. When called it SHALL select every question in the named game that is locked (`answerLocked === true`) and not yet revealed (`processedAt === undefined`), clear `answerLocked` (set to `false`), and repaint each card into its unlocked layout — restoring the answer buttons (which remain present inside the stored `postedBlocks`) and the live roster footer. It SHALL be idempotent and per-card isolated, and SHALL refuse a missing or disabled game via `requireWritableGame`.

#### Scenario: Restores buttons on a locked question

- **GIVEN** a game with one locked, unrevealed question
- **WHEN** `unlock_questions({ game })` is called
- **THEN** the record's `answerLocked` is cleared to `false`
- **AND** the card is repainted with its answer buttons restored

#### Scenario: Does not resurrect a revealed question

- **GIVEN** a question that is both `answerLocked: true` and revealed (`processedAt` set)
- **WHEN** `unlock_questions({ game })` is called
- **THEN** the record is not mutated and its revealed card is not edited

### Requirement: Click and modal submission are rejected when locked

When a vote button click (boolean/choice) or a freeform answer modal submission targets a question whose `answerLocked === true` and which is not yet revealed, the handler SHALL NOT persist or change the answer. A vote click SHALL be acknowledged and answered with an ephemeral localized "answers are locked" notice; a freeform modal SHALL open (or submit) in a read-only mode that does not accept a new submission. This lockout SHALL sit alongside the existing post-reveal (`processedAt`) lockout — either condition closes voting.

#### Scenario: Vote click after lock is rejected

- **GIVEN** a posted question with `answerLocked: true` and no `processedAt`
- **WHEN** a stale-client user clicks a vote button on it
- **THEN** no answer row is written or updated
- **AND** the user receives an ephemeral localized "answers are locked" notice

#### Scenario: Freeform submission after lock is rejected

- **GIVEN** a posted freeform question with `answerLocked: true` and no `processedAt`
- **WHEN** a user submits the answer modal
- **THEN** no answer is persisted
- **AND** the user is shown the locked read-only treatment

### Requirement: Lock-related user-facing strings are localized

Every direct-to-Slack string introduced by the lock feature — the locked-card notice and the ephemeral "answers are locked" click rejection — SHALL be resolved through the plugin translator (`sdk.t()` / the trivia dictionary) with keys present in both `en.ts` and `fr.ts`, and SHALL satisfy the key/placeholder parity test with no FR value left identical to EN.

#### Scenario: Notice and rejection strings exist in both dictionaries

- **WHEN** the trivia dictionary parity test runs
- **THEN** the locked-card notice key and the "answers are locked" key are present in both `en` and `fr`
- **AND** their FR values differ from their EN values
