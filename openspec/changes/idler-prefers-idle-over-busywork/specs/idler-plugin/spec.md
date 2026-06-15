## ADDED Requirements

### Requirement: Idle is the default over manufactured work

When no work unit is both fresh and workable this fire, the work task SHALL end without acting, and SHALL NOT invent activity to fill the fire. Re-reviewing a pull request whose head commit is unchanged since the unit's last review, re-triaging a quiet unit with no new source activity, or re-posting an `@claude review this` trigger with no new commits are NOT work and SHALL NOT be performed. The behavior contract SHALL frame doing nothing as the correct, expected outcome of an empty or stale ladder — not as a fallback to be avoided — and SHALL NOT rank any productive kind as "better than idling."

#### Scenario: Stale ladder ends the fire

- **GIVEN** every open unit is either blocked, already at its processed cursor, or has no fresh source activity
- **WHEN** the work task fires
- **THEN** it ends the fire without proposing a change, posting a review, or re-triggering a review
- **AND** no error is recorded — doing nothing is the expected outcome

#### Scenario: Review of an unchanged PR is not manufactured work

- **GIVEN** the only otherwise-selectable unit is a review whose PR head is unchanged since the unit's last-reviewed cursor
- **WHEN** the work task evaluates it
- **THEN** the unit is marked `blocked` so its priority sinks below `none`
- **AND** the fire ends without posting a redundant review

### Requirement: Review requires fresh commits

The review kind SHALL be productive only when the target pull request has new commits since the unit's last-reviewed cursor (the PR head recorded at the previous review). After reviewing, the work task SHALL record the reviewed head on the unit's reference cursor. When a PR has already been reviewed at its current head, the unit has no review work this fire and SHALL be marked `blocked` rather than re-reviewed. This gate applies to both self-review (Clack's own PRs) and review of human/external PRs.

#### Scenario: New commits make review productive

- **GIVEN** an open PR has commits newer than the unit's last-reviewed cursor and no higher-priority work exists
- **WHEN** the work task selects it
- **THEN** it performs a review pass and records the reviewed head on the reference cursor

#### Scenario: Already-reviewed head yields no review work

- **GIVEN** an open PR whose head equals the unit's last-reviewed cursor
- **WHEN** the work task evaluates it for review
- **THEN** no review is posted
- **AND** the unit is marked `blocked` so it sinks below `none`

## MODIFIED Requirements

### Requirement: Priority-ordered work-kind ladder

The work task SHALL select its single unit by priority, where the kind of work contributes to priority in the order: continue an in-flight PR, triage a candidate against the codebase, implement an approved unit, review an open PR with new commits, then nothing. A kind is productive only when it has fresh work to do (continue: new comments since cursor; triage: untriaged; review: new commits since the last-reviewed cursor); a kind with no fresh work does NOT outrank doing nothing. Triage and review SHALL run in query mode (no worktree); implement and continue SHALL run in worker mode.

#### Scenario: Higher-priority kind preempts lower

- **GIVEN** both an in-flight PR with new comments and an untriaged candidate are workable
- **WHEN** the work task selects a unit
- **THEN** it selects the in-flight PR (continue) over the candidate (triage)

#### Scenario: Review is the lowest productive kind, and only when fresh

- **GIVEN** no continue, triage, or implement work is available but an open PR has new commits since its last-reviewed cursor
- **WHEN** the work task selects a unit
- **THEN** it performs a review pass on that PR

#### Scenario: No fresh kind means do nothing

- **GIVEN** no continue, triage, or implement work is available and every reviewable PR is unchanged since its last-reviewed cursor
- **WHEN** the work task selects a unit
- **THEN** it ends the fire without acting rather than performing a redundant review

#### Scenario: Triage and review do not open a worktree

- **WHEN** the work task performs a triage or review step
- **THEN** it uses read/comment/review tools only and acquires no worktree

### Requirement: @claude review trigger loop

The work task SHALL be able to (re)trigger external review by posting an `@claude review this` comment on a PR and then stopping, deferring the reading of any resulting comments to a later tick. The plugin SHALL NOT block waiting on the external bot. The work task SHALL NOT re-post the trigger on a PR with no new commits since the last trigger — the trigger is a response to fresh state, not a way to fill an idle fire.

#### Scenario: Trigger review then defer

- **GIVEN** the work task has just pushed changes to a PR
- **WHEN** it elects to request external review
- **THEN** it posts an `@claude review this` comment and ends the tick
- **AND** a later tick processes any resulting comments via the continue kind

#### Scenario: No re-trigger without new commits

- **GIVEN** a PR that already has an `@claude review this` trigger with no new commits since
- **WHEN** the work task evaluates it
- **THEN** it does NOT re-post the trigger and takes no action on that unit this fire

#### Scenario: External bot absent is harmless

- **GIVEN** no external review bot is configured
- **WHEN** the trigger comment is posted
- **THEN** no error occurs and the unit waits at lowered priority until comments appear
