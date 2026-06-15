## ADDED Requirements

### Requirement: Worker stages a spinoff intent without acquiring a second worker

The worker mode SHALL expose a `propose_spinoff` tool that lets the worker stage an intent to carve a slice of its current changes into a separate PR. The tool SHALL accept a list of file paths defining the slice, a description, and a proposed branch name conforming to the `clack/{type}/{name}` convention. The tool SHALL be available only in worker mode and only to the dev+ roles that can already drive the Changes Workflow, consistent with the other worker tools. The worker SHALL NOT acquire a pool worker or start a change workflow itself; it only stages the intent, which the orchestrator drains after the worker run completes.

#### Scenario: Worker stages a spinoff for a slice of its changes

- **WHEN** the worker calls `propose_spinoff` with a set of paths, a description, and a valid proposed branch name
- **THEN** the intent is staged and returned to the worker as a reference, and no pool worker is acquired during the worker run

#### Scenario: Proposed branch name is invalid

- **WHEN** the worker calls `propose_spinoff` with a branch name that does not match `clack/{type}/{name}`
- **THEN** the tool returns an error and stages nothing

#### Scenario: No spinoff is staged

- **WHEN** a worker run completes without calling `propose_spinoff`
- **THEN** `ExecutionResult` carries no spinoff intents and the orchestrator performs no spinoff dispatch, leaving behavior identical to a run without the feature

### Requirement: Spinoff moves the slice's code, not a re-implementation

When `propose_spinoff` is called, the system SHALL capture the actual changes to the named paths — both modifications to tracked files and newly-added (untracked) files — as a patch persisted to a host-shared location, and SHALL revert those paths in the originating worktree so the slice no longer appears in the originating branch's PR. Tracked paths SHALL be reverted and newly-added paths SHALL be removed. The sibling session SHALL apply this captured patch on its fresh branch rather than regenerating the changes.

#### Scenario: Slice is removed from the originating worktree

- **WHEN** a spinoff is staged for a set of paths
- **THEN** those paths are reverted/removed in the originating worktree and the originating branch's subsequent push and PR no longer contain the slice's changes

#### Scenario: Sibling applies the captured patch

- **WHEN** the orchestrator provisions the sibling session
- **THEN** the sibling worktree applies the captured patch on its fresh branch and proceeds through the normal commit/push/PR flow with the slice's exact changes

#### Scenario: Captured patch fails to apply on the sibling branch

- **WHEN** applying the captured patch on the sibling's fresh branch fails
- **THEN** the sibling reports the failure in its own thread, naming the retained patch's location for manual recovery, and the originating session and any other siblings are unaffected

### Requirement: Orchestrator provisions a standalone sibling change session per intent

After a worker run completes, the orchestrator SHALL drain staged spinoff intents and provision one standalone sibling change session per intent. Each sibling SHALL receive a fresh, non-colliding branch, its own acquired pool worker, and its own `ActiveChangeState`. Sibling provisioning SHALL occur only after the originating worker run has fully returned, and siblings SHALL be provisioned sequentially. The 1:1:1 binding of session-to-branch-to-PR SHALL be preserved: no existing session's branch is ever mutated.

#### Scenario: Sibling provisioned after the parent run returns

- **WHEN** the originating worker run completes with one staged spinoff and has fully returned
- **THEN** the orchestrator acquires a worker for the sibling (queuing if the pool is busy) and runs its change workflow on a fresh branch

#### Scenario: Proposed sibling branch name collides with an existing branch

- **WHEN** the proposed sibling branch name matches an existing worktree or branch
- **THEN** the orchestrator disambiguates the name before provisioning so the sibling gets a unique branch

#### Scenario: Pool is exhausted when provisioning a sibling

- **WHEN** acquiring a worker for a sibling is rejected because the pool queue is full
- **THEN** the sibling fails gracefully in its own thread with a retry hint, and the originating session and other siblings are unaffected

#### Scenario: Sibling provisioning bypasses the per-user active-change cap

- **WHEN** the originating user is already at the per-user active-change cap and a sibling is being provisioned
- **THEN** the sibling is provisioned anyway because it is orchestrator-initiated, while still being subject to pool capacity limits

#### Scenario: Originating PR is already merged or closed before the sibling is provisioned

- **WHEN** a spinoff intent is staged but the originating PR is merged or closed before the orchestrator provisions the sibling
- **THEN** the sibling is still provisioned as an independent session carrying the slice's patch, and the retained patch is never discarded on account of the parent's state

### Requirement: Sibling owns its own Slack thread and follow-up lifecycle

Each sibling session SHALL be anchored to a NEW top-level Slack message in the originating channel, not a threaded reply under the originating thread. The orchestrator SHALL post a cross-link between the originating thread and the sibling thread. The sibling SHALL be independently manageable through the existing follow-up commands (review, update, merge, close) in its own thread, with no lifecycle coupling to the originating session.

#### Scenario: Sibling gets a new top-level thread

- **WHEN** a sibling session is provisioned
- **THEN** a new top-level message is posted in the originating channel and the sibling's session is bound to that message's thread, distinct from the originating thread

#### Scenario: Threads are cross-linked

- **WHEN** a sibling session is provisioned
- **THEN** the originating thread shows a link to the sibling thread and the sibling thread shows a link back to the originating thread

#### Scenario: Sibling follow-up does not affect the parent

- **WHEN** the sibling's PR is merged or closed via a follow-up in the sibling thread
- **THEN** the originating session's PR and state are unchanged
