# trivia-catch-up Specification

## Purpose

The trivia plugin's consumer of the cron-catch-up capability: after every boot, walk each enabled game and recover cron fires missed while the process was down. Recovery follows the round's chronology (lock → reveal → question), fires a question only when players still get meaningful answering time, never backfills multi-day gaps, and tells the deployment owner when a quiz day is unrecoverable.

## Requirements

### Requirement: Trivia Registers A Delayed-Boot Handler

The trivia plugin SHALL register an `onDelayedBoot` handler during init (alongside its cron reconcile). On dispatch, the handler SHALL process each configured game sequentially (one at a time), and within each game SHALL evaluate missed fires in the order `:lock` → `:reveal` → `:question`, awaiting each catch-up fire to completion before evaluating the next step. Missed `:prep` fires SHALL never be caught up (the question prompt falls back to inline generation).

#### Scenario: Per-game pipeline order

- **WHEN** a game has missed fires on both its `:reveal` and `:question` specs
- **THEN** the handler SHALL fire the reveal catch-up first and await its completion before evaluating the question catch-up

#### Scenario: Games processed sequentially

- **WHEN** two games both have missed fires
- **THEN** the second game's pipeline SHALL NOT start until the first game's pipeline has completed (bounding concurrent Claude sessions to one)

#### Scenario: Prep is never caught up

- **WHEN** a game's `:prep` spec has missed fires and no other spec does
- **THEN** the handler SHALL fire nothing and send no notification for that game

### Requirement: Missed Lock And Reveal Fire Unconditionally

For each game, when `sdk.missedRuns` reports at least one missed occurrence for the game's `:lock` spec, the handler SHALL fire it via `sdk.runCronJobNow`; likewise for the `:reveal` spec. These fires SHALL have no additional guards (the lock and reveal prompts are self-guarding: locking is harmless when nothing is open, and the reveal's empty-batch branch silently skips when no question was posted) and SHALL NOT notify the owner.

#### Scenario: Missed lock fires on boot

- **WHEN** the process was down across a game's lock slot and boots before the reveal slot
- **THEN** the handler SHALL fire the `:lock` job immediately (locking answers late) and send no owner DM

#### Scenario: Missed reveal fires and self-skips when nothing was posted

- **WHEN** the process was down across both the question and reveal slots (nothing was posted that day)
- **AND** the handler fires the missed `:reveal` job
- **THEN** the reveal run SHALL silently skip via its existing empty-batch branch (no error, no owner DM from the reveal step)

### Requirement: Missed Question Fires Only Inside The Recovery Window

For each game with at least one missed `:question` occurrence, the handler SHALL fire the question via `sdk.runCronJobNow` ONLY IF both guards pass, computed with `cron-parser` in the game's timezone against the game's *deadline cron* (`lockCron` when the game has one, otherwise `revealCron`):

- **(a)** the next regular `questionCron` occurrence is AFTER the next deadline occurrence (no natural fire will cover the current round), and
- **(b)** `now + 2 hours` is at or before the next deadline occurrence (players still have time to answer).

At most ONE catch-up question fire SHALL happen per game per boot, regardless of how many occurrences were missed.

#### Scenario: Short outage recovers the day

- **WHEN** a game runs daily (question 10:00, lock 15:00), the process was down 09:50–10:30, and the handler dispatches at 10:33
- **THEN** guard (a) passes (next question fire is tomorrow 10:00, after today's 15:00 lock) and guard (b) passes (12:33 ≤ 15:00)
- **AND** the handler SHALL fire the `:question` job once

#### Scenario: Too close to the deadline

- **WHEN** the same game's handler dispatches at 14:33 (less than 2 hours before the 15:00 lock)
- **THEN** the question SHALL NOT fire

#### Scenario: Next natural fire covers the day

- **WHEN** the process was down across yesterday's question slot and boots today at 08:00 (before today's 10:00 question fire)
- **THEN** guard (a) fails (today's 10:00 fire precedes today's 15:00 lock) and the question SHALL NOT fire — the regular fire covers today

#### Scenario: Deadline falls back to revealCron

- **WHEN** a game has no `lockCron`
- **THEN** both guards SHALL be computed against the next `revealCron` occurrence

#### Scenario: Unparseable deadline cron skips the game gracefully

- **WHEN** a game's deadline cron expression (`lockCron` or `revealCron`) fails to parse while evaluating the question guards
- **THEN** the handler SHALL log the error and skip that game's question catch-up (firing nothing for it), continuing with the remaining games

#### Scenario: Multi-day gap fires at most once

- **WHEN** `missedRuns` reports three missed question occurrences and both guards pass
- **THEN** exactly one catch-up question fire SHALL happen

### Requirement: Owner Notification On Unrecoverable Quiz

When a game has at least one missed `:question` occurrence and the guards reject the catch-up fire, the handler SHALL notify the deployment owner via `sdk.dmOwner`, naming the game and the missed occurrence date(s) from `lastExpectedRuns`. The DM text SHALL resolve through `sdk.t()` with entries in both the plugin's `en` and `fr` dictionaries. No owner DM SHALL be sent for successful catch-up fires or for missed lock/reveal/prep fires.

#### Scenario: Lost quiz day notifies the owner

- **WHEN** a game's question slot was missed and guard (b) fails at dispatch time
- **THEN** the owner SHALL receive a DM naming the game and the missed date(s)
- **AND** the DM string SHALL come from the plugin's registered dictionary via `sdk.t()`

#### Scenario: Successful catch-up is silent

- **WHEN** a game's missed question fires successfully through the guards
- **THEN** no owner DM SHALL be sent
