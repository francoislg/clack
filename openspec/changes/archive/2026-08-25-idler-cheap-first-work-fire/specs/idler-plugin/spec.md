## ADDED Requirements

### Requirement: Cheap-first freshness check before any integration attach

The work fire SHALL determine whether it has anything to do using ONLY always-on plugin tools, before any `attach_integration` call. Step 1 is `list_top_ideas`; freshness is judged from the ledger state the sync tiers primed (`freshInput`, `blocked`, priority, cursors) — the work fire SHALL NOT sweep sources or probe PRs to find work. Reference re-reads (including the canonical PR review check) run only AFTER a single unit is selected. When the selected unit's re-read reveals no fresh work after all, the fire SHALL park that unit (`upsert_idea` `blocked: true`), record the empty outcome, and END — it SHALL NOT cascade to the next unit with another deep read in the same fire.

#### Scenario: Freshness check precedes any attach

- **WHEN** a work fire starts
- **THEN** `list_top_ideas` is called before any `attach_integration` call
- **AND** when the ledger shows no fresh unit, no integration is attached at all

#### Scenario: Stale-on-re-read parks and ends

- **GIVEN** the top unit's ledger state says fresh but re-reading its references shows nothing new
- **WHEN** the work fire verifies the selected unit
- **THEN** the unit is parked via `upsert_idea` `blocked: true`
- **AND** the empty outcome is recorded and the fire ends without deep-reading another unit

#### Scenario: The fire trusts sync-primed state

- **GIVEN** the ledger was primed by a preceding sync fire
- **WHEN** the work fire selects a unit
- **THEN** selection uses the ledger's priority/freshness state without re-discovering work from sources

## MODIFIED Requirements

### Requirement: Idle is the default over manufactured work

When no work unit is both fresh and workable this fire, the work task SHALL end without acting, and SHALL NOT invent activity to fill the fire. Re-reviewing a pull request whose head commit is unchanged since the unit's last review, re-triaging a quiet unit with no new source activity, or re-posting an `@claude review this` trigger with no new commits are NOT work and SHALL NOT be performed. The behavior contract SHALL frame doing nothing as the correct, expected outcome of an empty or stale ladder — not as a fallback to be avoided — and SHALL NOT rank any productive kind as "better than idling." Emptiness SHALL be determined via the cheap-first path — from the ledger alone, with no integration attach — and an empty fire SHALL record its outcome via `record_fire_outcome({ outcome: "empty" })` immediately before ending via skip, so the night circuit breaker can observe consecutive empty fires.

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

#### Scenario: Empty fire ends cheaply and records the outcome

- **GIVEN** the ledger shows no fresh unit
- **WHEN** the work task fires
- **THEN** the fire ends after `list_top_ideas` and `record_fire_outcome({ outcome: "empty" })` with no `attach_integration` call
- **AND** the response is skipped

### Requirement: Gated GitHub integration attach

The idler SHALL attach the `github` integration only when PR references are in play — i.e. when any tracked unit carries a PR reference OR the quick-fetch lists open Clack-authored pull requests. Fires with no PR references in play SHALL NOT attach the integration and SHALL incur no added cost from the canonical check. In the WORK fire the attach is additionally LAZY: it happens only after a single unit has been selected from the ledger and that unit's references require GitHub access — never during freshness determination or unit selection.

#### Scenario: Quiet fire skips the attach

- **GIVEN** no tracked unit references a PR and no open Clack-authored PRs exist
- **WHEN** a sync or work fire runs
- **THEN** `attach_integration("github")` is not called and no review probes are made

#### Scenario: Open Clack PRs trigger the attach

- **GIVEN** the quick-fetch lists at least one open Clack-authored PR
- **WHEN** the sync fire's maintenance pass runs
- **THEN** the `github` integration is attached before the per-PR review probes

#### Scenario: Work fire attaches only after selection

- **GIVEN** several tracked units carry PR references
- **WHEN** the work fire determines freshness and selects its unit
- **THEN** `attach_integration("github")` is called only after the single unit is selected, to re-read that unit's references
