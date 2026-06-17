## MODIFIED Requirements

### Requirement: Daily relevance review

The system SHALL run a daily core-scheduled review (a `systemActor` cron job, channelless, firing at midnight in the configured timezone) that walks every memory entry and keeps the store relevant. For each entry that carries `references`, the review SHALL re-fetch current status via each reference's `howToRead` before judging. The review SHALL then make a three-way decision for each entry:

- **still relevant** — leave it, or call `remember` to refresh its `what` / push `staleAfter.date` out to reflect new information;
- **done and worth remembering** — distill the entry into a lean note and call `archive(id, leanNote)`, which atomically writes the lean note to the archive and removes the active entry (honoring the pre-expire hook). The review composes the lean note's `summary`/`outcome` (and optional `link`) from the re-fetched status at this moment;
- **noise, never worth remembering** — call `forget(id)` (record-level delete, honoring the pre-expire hook).

Entries with no external reference SHALL be judged on their `staleAfter` date and advisory rationale alone. After walking the active entries, the review SHALL run the mechanical archive-prune step, dropping archived records older than `archiveRetentionDays` (no fetch, no judgment).

#### Scenario: Review re-fetches referenced info before judging

- **GIVEN** an entry referencing an external issue
- **WHEN** the daily review processes it
- **THEN** it re-runs the reference's `howToRead` to fetch current status before deciding relevance

#### Scenario: Review archives a done-but-worth-remembering entry

- **GIVEN** an entry whose referenced work is resolved (e.g. its PR merged) and whose `staleAfter` has passed
- **WHEN** the daily review processes it
- **THEN** it distills a lean note and calls `archive(id, leanNote)`, removing the active entry and writing the lean record, subject to the pre-expire hook

#### Scenario: Review forgets a noise entry

- **GIVEN** an entry that is no longer relevant and not worth remembering
- **WHEN** the daily review processes it
- **THEN** it calls `forget(id)`, a true delete with no archive record written

#### Scenario: Review keeps and refreshes a still-relevant entry

- **GIVEN** an entry whose referenced info shows it still matters
- **WHEN** the daily review processes it
- **THEN** the entry is retained and its `staleAfter`/`what` may be updated to reflect the new information

#### Scenario: Note judged without fetching

- **GIVEN** a `note:` entry with no references
- **WHEN** the daily review processes it
- **THEN** relevance is judged from its `staleAfter` date and rationale, with no fetch

#### Scenario: Archive prune runs after the active walk

- **WHEN** the daily review finishes walking the active entries
- **THEN** it removes archived records older than `archiveRetentionDays` mechanically, without fetching anything
