## ADDED Requirements

### Requirement: Resume-from-Remote-Branch Acquire

The system SHALL support an acquire mode that re-adopts an existing remote branch (a pull request's head) without resetting it to the default branch. When this mode is requested and the branch is not already on a warm worker, the system SHALL fetch the remote branch and check it out from its remote head (`git fetch origin <branch>` then `git checkout -B <branch> origin/<branch>`), preserving the branch's existing commits, and SHALL run the idempotent install step before claiming the worker. This mode SHALL NOT replace the default fresh-branch acquire (`git checkout -B <branch> origin/<defaultBranch>`); it is selected explicitly for continuation of an existing PR.

#### Scenario: Cold PR branch is re-adopted intact

- **GIVEN** a pull request branch whose worktree was previously reclaimed (no warm worker has it)
- **WHEN** acquire is called in resume-from-remote-branch mode for that branch
- **THEN** an idle worker is selected and the branch is checked out from `origin/<branch>` (its remote head)
- **AND** the branch's existing commits are preserved (no reset to the default branch)
- **AND** the idempotent install step runs before the worker is claimed

#### Scenario: Warm branch resume is unchanged

- **GIVEN** a worker already has the requested branch checked out
- **WHEN** acquire is called in resume-from-remote-branch mode
- **THEN** that worker is claimed without a checkout, exactly as the existing same-branch resume path

#### Scenario: Default fresh-branch acquire is unaffected

- **WHEN** acquire is called without resume-from-remote-branch mode
- **THEN** the existing decision tree applies, including `git checkout -B <branch> origin/<defaultBranch>` for a branch switch

#### Scenario: Remote branch missing at acquire fails safely

- **GIVEN** resume-from-remote-branch mode is requested for a branch that no longer exists on origin (deleted or force-removed)
- **WHEN** the remote fetch/checkout finds no such remote head
- **THEN** acquire fails with a reported error and does NOT fall back to resetting from `origin/<defaultBranch>` (which would discard the PR's intended base)
- **AND** the caller records the failure on the unit rather than clobbering the branch

### Requirement: Idle Release Defers to Active Idler Work

The idle-release sweep SHALL NOT detach a worker whose branch is being actively advanced by the idler. An idler action on a unit SHALL reset the worker's idle clock so an in-progress continuation is not reclaimed mid-flight.

#### Scenario: Idler action resets the idle clock

- **GIVEN** a worker holding a PR branch the idler just acted on
- **WHEN** the idle-release sweep runs before `idleReleaseHours` has elapsed since that action
- **THEN** the worker is not detached
