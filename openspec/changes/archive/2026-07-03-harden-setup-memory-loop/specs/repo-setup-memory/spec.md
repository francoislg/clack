# repo-setup-memory — delta

## MODIFIED Requirements

### Requirement: Deterministic learned-notes injection

The system SHALL look up the run kind's keyed setup entry server-side at prompt-build time (`getMemory`) and inject its content into the system prompt as a clearly-labeled notes-from-previous-runs section — for worker runs in the execution prompt assembly, and for tester runs in the tester system prompt (fetched by the caller and passed into the pure prompt builder). When no entry exists, or the lookup fails, the section SHALL be omitted entirely and the run proceeds as a normal cold run — never an error.

The lookup (`loadSetupNotes`) SHALL return the entry's `updatedAt` timestamp alongside the notes text, and each injection site SHALL record the injection outcome in the run's execution log: one line stating either that notes were injected (with their character length and the entry's `updatedAt`) or that the run is cold (no notes). The log line SHALL be written on every run so the absence of notes is distinguishable from a logging gap.

#### Scenario: Notes injected when an entry exists

- **GIVEN** `tester-setup:acme-app` exists in memory
- **WHEN** a tester run is launched for repo `acme-app`
- **THEN** the tester system prompt contains a notes-from-previous-runs section with the entry's content
- **AND** no tool call is required for the notes to be present

#### Scenario: Cold run on a repo with no entry

- **GIVEN** no `worker-setup:acme-app` entry exists
- **WHEN** a worker run is launched for repo `acme-app`
- **THEN** the system prompt contains no notes section
- **AND** the run proceeds normally

#### Scenario: Memory store failure degrades to cold run

- **GIVEN** the memory store lookup throws or returns null
- **WHEN** the prompt is assembled
- **THEN** the prompt is built without the notes section and the run is not aborted

#### Scenario: Entry with empty what is a cold run

- **GIVEN** `tester-setup:acme-app` exists but its `what` is empty (or whitespace-only)
- **WHEN** a tester run is launched for repo `acme-app`
- **THEN** `loadSetupNotes` returns null, no notes section is injected, and the execution log reports a cold run

#### Scenario: Injection is visible in the execution log

- **GIVEN** `tester-setup:acme-app` exists with a 3,166-character recipe last updated at a known timestamp
- **WHEN** a tester run is launched for repo `acme-app`
- **THEN** the run's execution log contains a line stating notes were injected, their character length, and the entry's `updatedAt`

#### Scenario: Cold run is visible in the execution log

- **GIVEN** no `worker-setup:acme-app` entry exists
- **WHEN** a worker run is launched for repo `acme-app`
- **THEN** the run's execution log contains a line stating the run is cold (no setup notes)

### Requirement: Record, verify, and rewrite directive

The worker and tester system prompts SHALL instruct Claude to (1) start from the injected learned notes when present, (2) treat them as advisory descriptions of the repo *as last seen* — when a noted step fails or conflicts with the repository's actual state, trust the repository, and (3) at the end of the run, if setup knowledge changed (additions, corrections, or removals), rewrite the keyed entry via `remember` with the current full recipe rather than appending deltas. The directive SHALL suggest cross-linking the sibling entry for the same repo via `linkedMemories`.

The directive SHALL state explicitly that the full recipe body belongs in the `remember` call's `what` argument — notwithstanding the schema's usual one-line convention — and that the recipe must not be placed in (or split across) `why` or `nextSteps`, so a single rewrite call carries the complete entry.

#### Scenario: Repo evolved past the notes

- **GIVEN** the injected notes say the app boots on port 3000
- **WHEN** the tester finds the repo's config now uses port 4123
- **THEN** the tester follows the repository's actual state
- **AND** rewrites `tester-setup:<repo>` with the corrected port at end of run

#### Scenario: Nothing changed

- **GIVEN** the injected notes match reality and the run learns nothing new
- **WHEN** the run ends
- **THEN** no `remember` rewrite is required

#### Scenario: Memory write failure at end of run is non-fatal

- **GIVEN** setup knowledge changed during the run
- **WHEN** the end-of-run `remember` call fails (store error, disk issue)
- **THEN** the run's deliverable (PR work or recording/report) is unaffected — the failure only means the notes are not updated for the next run

#### Scenario: Directive places the recipe in what

- **GIVEN** a run that learned new setup steps
- **WHEN** it performs the end-of-run rewrite
- **THEN** the directive it followed states the full recipe goes in `what` (not `why` or `nextSteps`), yielding one complete rewrite call rather than a summary in `what` with content scattered across other fields
