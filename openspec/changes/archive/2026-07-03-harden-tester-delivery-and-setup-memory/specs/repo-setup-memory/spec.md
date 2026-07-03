## ADDED Requirements

### Requirement: Setup-memory salvage on corrective resume

When a tester run trips the deliverable gate AND the run's `tester-setup:<repo>` memory entry was not rewritten during the run, the corrective-resume prompt SHALL additionally instruct Claude to rewrite the setup entry per the standard record/verify/rewrite directive, so setup learnings survive a run that died before its end-of-run rewrite. Whether the entry was rewritten SHALL be determined by capturing the entry's `updatedAt` BEFORE the initial run starts and re-fetching it during corrective-prompt assembly: a changed value (or an entry appearing where none existed) means rewritten — a value-equality comparison, not a wall-clock ordering, so clock skew cannot affect the decision (no tool-call instrumentation either). When the entry WAS rewritten during the run, the corrective prompt SHALL omit the rewrite instruction.

#### Scenario: Learnings salvaged through the corrective resume

- **WHEN** the gate trips on a run that fought through novel setup problems and never called `remember` for its setup entry
- **THEN** the corrective prompt includes the setup-entry rewrite instruction and a compliant resumed turn persists the learnings

#### Scenario: Entry already rewritten mid-run

- **WHEN** the gate trips but the setup entry's `updatedAt` differs from the value captured before the run started
- **THEN** the corrective prompt contains no rewrite instruction

#### Scenario: Salvage check never blocks the gate

- **WHEN** reading the setup entry for the salvage check fails (store error) or finds no entry (missing)
- **THEN** the corrective resume proceeds with the rewrite instruction INCLUDED in both cases (fail-open — a redundant rewrite instruction is harmless because the directive already tells Claude to skip the rewrite when nothing changed), any store error is logged, and the deliverable gate behavior is unaffected
