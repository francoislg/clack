## MODIFIED Requirements

### Requirement: Pre-Swap Drain Gate

Before starting the new container, the deploy SHALL drain the running bot by stopping the old container with a bounded stop timeout (`docker stop -t <budget>`), delegating the drain to the in-process graceful-shutdown sequence. The stop timeout SHALL be at least the process grace budget so the process is allowed to finish in-flight runs and exit cleanly before Docker escalates to SIGKILL. The deploy SHALL NOT poll `GET /status` externally to gate the swap.

#### Scenario: Old container stopped with a bounded timeout

- **WHEN** the deploy reaches the container swap
- **THEN** it stops the old container with `docker stop -t <budget>`, where `<budget>` is at least the process grace budget
- **AND** the process drains its in-flight runs in-process before exiting

#### Scenario: Idle bot exits promptly

- **WHEN** the old container is stopped
- **AND** the process has no in-flight runs
- **THEN** the process exits promptly and the deploy proceeds to start the new container without waiting the full timeout

#### Scenario: Busy bot is allowed to finish within the timeout

- **WHEN** the old container is stopped
- **AND** in-flight runs are still executing
- **THEN** the process is allowed up to its grace budget to finish those runs
- **AND** the deploy proceeds to start the new container once the process has exited

#### Scenario: Wedged run does not block the deploy indefinitely

- **WHEN** in-flight runs have not finished by the grace budget
- **THEN** the process stops the stragglers and exits
- **AND** Docker's stop timeout ensures the swap proceeds regardless

### Requirement: Deploy Skill Surfaces the Drain Phase

The `/deploy` skill SHALL surface the drain phase to the operator: its Monitor output filter SHALL match the deploy script's drain-phase marker (the progress line the script prints before the bounded `docker stop -t`), and its phase-acknowledgement guidance SHALL include the drain phase so the operator understands why the deploy may pause on `docker stop` before the swap. (The in-process drain's own log lines go to `docker logs`, not the deploy script's stdout, so the filter keys off the script marker.)

#### Scenario: Skill acknowledges the drain phase

- **WHEN** the deploy prints its drain-phase marker before stopping the old container
- **THEN** the skill's Monitor filter captures that marker
- **AND** the skill has a phase-acknowledgement entry for the drain phase
